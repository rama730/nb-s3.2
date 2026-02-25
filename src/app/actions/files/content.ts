"use server";

import { db } from "@/lib/db";
import { projectNodes } from "@/lib/db/schema";
import type { ProjectNode } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
    assertProjectReadAccess,
    assertProjectWriteAccess,
    assertNodeNotLockedByAnotherUser,
} from "./_shared";
import {
    formatSqlLight,
    FILES_ERROR_CODES,
    UUID_RE,
    type FilesActionResult,
} from "./_constants";

export async function getProjectFileContent(projectId: string, nodeId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Verify read access (works for public projects too)
    await assertProjectReadAccess(projectId, user?.id ?? null);

    const node = await db.query.projectNodes.findFirst({
        where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
        columns: { s3Key: true, size: true }
    });

    if (!node || !node.s3Key) {
        throw new Error("File not found");
    }

    const MAX_INLINE_BYTES = 2 * 1024 * 1024; // 2MB safety cap
    if (node.size && node.size > MAX_INLINE_BYTES) {
        throw new Error("File too large for inline download. Use a signed URL instead.");
    }

    // Use admin client to bypass RLS for public viewers
    const adminClient = await createAdminClient();
    const { data, error } = await adminClient.storage.from("project-files").download(node.s3Key);

    if (error) throw error;
    return await data.text();
}

export async function getProjectFileSignedUrl(projectId: string, nodeId: string, ttlSeconds: number = 300) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Verify read access (works for public projects too)
    await assertProjectReadAccess(projectId, user?.id ?? null);

    const node = await db.query.projectNodes.findFirst({
        where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
        columns: { s3Key: true }
    });

    if (!node || !node.s3Key) {
        throw new Error("File not found");
    }

    // Use admin client to bypass storage policy edge-cases (public viewers).
    const adminClient = await createAdminClient();
    const { data, error } = await adminClient.storage
        .from("project-files")
        .createSignedUrl(node.s3Key, Math.max(30, Math.min(3600, ttlSeconds)));

    if (error) throw error;
    if (!data?.signedUrl) throw new Error("Failed to create signed URL");

    const now = Date.now();
    const ttlMs = Math.max(30, Math.min(3600, ttlSeconds)) * 1000;
    return { url: data.signedUrl, expiresAt: now + ttlMs };
}

export async function getProjectFileSignedUrlBatch(
    projectId: string,
    nodeIds: string[],
    ttlSeconds: number = 300
): Promise<Record<string, { url: string; expiresAt: number }>> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    await assertProjectReadAccess(projectId, user?.id ?? null);

    const unique = Array.from(new Set(nodeIds)).filter((id) => UUID_RE.test(id));
    if (unique.length === 0) return {};
    if (unique.length > 50) throw new Error("Too many nodes requested. Max: 50");

    const nodes = await db.query.projectNodes.findMany({
        where: and(eq(projectNodes.projectId, projectId), inArray(projectNodes.id, unique)),
        columns: { id: true, s3Key: true },
    });

    const clampedTtl = Math.max(30, Math.min(3600, ttlSeconds));
    const adminClient = await createAdminClient();
    const now = Date.now();

    const entries = await Promise.all(
        nodes
            .filter((n) => n.s3Key)
            .map(async (node) => {
                const { data, error } = await adminClient.storage
                    .from("project-files")
                    .createSignedUrl(node.s3Key!, clampedTtl);
                if (error || !data?.signedUrl) return null;
                return [node.id, { url: data.signedUrl, expiresAt: now + clampedTtl * 1000 }] as const;
            })
    );

    return Object.fromEntries(entries.filter(Boolean) as Array<readonly [string, { url: string; expiresAt: number }]>);
}

export async function formatProjectFileContent(projectId: string, filename: string, content: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectWriteAccess(projectId, user.id);

    const ext = filename.split('.').pop()?.toLowerCase();

    if (ext === "sql") {
        return formatSqlLight(content);
    }

    const parser =
        ext === 'ts' || ext === 'tsx' ? 'typescript' :
            ext === 'js' || ext === 'jsx' ? 'babel' :
                ext === 'json' ? 'json' :
                    ext === 'md' ? 'markdown' :
                        ext === 'css' ? 'css' :
                            ext === 'html' ? 'html' :
                                null;

    if (!parser) return content;

    try {
        const prettier = await import("prettier");
        return await prettier.format(content, { parser });
    } catch {
        // Keep content unchanged if parser fails to avoid destructive formatting.
        return content;
    }
}

export async function updateProjectFileStats(projectId: string, nodeId: string, size: number) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectWriteAccess(projectId, user.id);

    await assertNodeNotLockedByAnotherUser(projectId, nodeId, user.id);

    // Update size and updatedAt
    const [node] = await db.update(projectNodes)
        .set({
            size: size,
            updatedAt: new Date()
        })
        .where(and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)))
        .returning();

    revalidatePath(`/projects/${projectId}`);
    return node;
}

export async function updateProjectFileStatsSafe(
    projectId: string,
    nodeId: string,
    size: number
): Promise<FilesActionResult<ProjectNode>> {
    try {
        const node = await updateProjectFileStats(projectId, nodeId, size);
        return { success: true, data: node };
    } catch (error) {
        return {
            success: false,
            code: FILES_ERROR_CODES.UNKNOWN_ERROR,
            message: error instanceof Error ? error.message : "Failed to update file stats",
        };
    }
}
