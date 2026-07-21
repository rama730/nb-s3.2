"use server";

import { db } from "@/lib/db";
import { projectNodes, fileVersions, profiles } from "@/lib/db/schema";
import type { ProjectNode } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { runInFlightDeduped } from "@/lib/utils/inflight-dedupe";
import { revalidatePath } from "next/cache";
import { parseProjectFileKey } from "@/lib/storage/project-file-key";
import {
    assertProjectFileReadAccess,
    assertProjectWriteAccess,
    assertProjectWriteAccessTx,
    assertNodeNotLockedByAnotherUser,
} from "@/lib/files/internal-helpers";
import {
    formatSqlLight,
    FILES_ERROR_CODES,
    UUID_RE,
    type FilesActionResult,
} from "./_constants";

export async function getProjectFileContent(
    projectId: string,
    nodeId: string,
    options?: { skipFileTabCheck?: boolean },
) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const actorId = user?.id ?? null;
    return await runInFlightDeduped(`files:content:${projectId}:${nodeId}:${actorId ?? "anon"}`, async () => {
        // Verify read access (works for public projects too)
        // When called from the doc system for linked-node content, skip the
        // Files-tab visibility gate — the doc layer already verified doc-level
        // permissions so we only need basic project read access here.
        if (options?.skipFileTabCheck) {
            const { assertProjectReadAccess } = await import("@/lib/files/internal-helpers");
            await assertProjectReadAccess(projectId, actorId);
        } else {
            await assertProjectFileReadAccess(projectId, actorId);
        }

        const node = await db.query.projectNodes.findFirst({
            where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
            columns: { s3Key: true, size: true, gitHash: true, path: true }
        });

        if (!node) {
            throw new Error("File not found");
        }

        // --- VIRTUAL FS LAZY LOADING ---
        if (!node.s3Key && node.gitHash) {
            const { projects } = await import("@/lib/db/schema");
            const project = await db.query.projects.findFirst({
                where: eq(projects.id, projectId),
                columns: { importSource: true }
            });
            const importSource = project?.importSource as any;
            if (importSource && importSource.type === "github" && importSource.repoUrl) {
                const urlParts = importSource.repoUrl.replace(/\/$/, '').split('/');
                const repoName = urlParts.pop();
                const ownerName = urlParts.pop();
                const apiUrl = `https://api.github.com/repos/${ownerName}/${repoName}/git/blobs/${node.gitHash}`;

                let headers: Record<string, string> = { 'Accept': 'application/vnd.github.v3+json' };
                const token = importSource.metadata?.importAuth || importSource.metadata?.githubToken;
                if (token) headers['Authorization'] = `Bearer ${token}`;

                const res = await fetch(apiUrl, { headers });
                if (res.ok) {
                    const data = await res.json();
                    if (data.encoding === 'base64') {
                        return Buffer.from(data.content, 'base64').toString('utf8');
                    }
                    return data.content;
                }
            }
        }

        if (!node.s3Key) {
            throw new Error("File content not available yet");
        }
        const parsedKey = parseProjectFileKey(node.s3Key);
        if (!parsedKey || parsedKey.projectId !== projectId) {
            throw new Error("File key does not belong to this project");
        }

        const MAX_INLINE_BYTES = 2 * 1024 * 1024; // 2MB safety cap
        const nodeSize =
            typeof node.size === "number" && Number.isFinite(node.size) && node.size >= 0 ? node.size : null;
        const hasKnownSize = nodeSize !== null;
        if (nodeSize !== null && nodeSize > MAX_INLINE_BYTES) {
            throw new Error("File too large for inline download. Use a signed URL instead.");
        }

        let fileData: Blob;
        try {
            const adminClient = await createAdminClient();
            const { data, error } = await adminClient.storage.from("project-files").download(node.s3Key);
            if (error) throw error;
            if (!data) throw new Error("No data returned from storage");
            fileData = data;
        } catch (downloadError) {
            console.error(`[getProjectFileContent] S3 download failed for key ${node.s3Key}:`, downloadError);
            
            // Try to recover from GitHub contents by path
            const recoveredText = await tryRecoverFromGitHub(projectId, node.path);
            if (recoveredText !== null) {
                try {
                    const adminClient = await createAdminClient();
                    const buffer = Buffer.from(recoveredText, 'utf8');
                    await adminClient.storage.from('project-files').upload(node.s3Key, buffer, {
                        contentType: 'text/plain',
                        upsert: true
                    });
                    console.log(`[getProjectFileContent] Successfully healed missing storage file for key ${node.s3Key}`);
                } catch (uploadErr) {
                    console.error("[getProjectFileContent] Healing S3 upload failed:", uploadErr);
                }
                return recoveredText;
            }
            
            // Recovery failed/unavailable — return empty string to prevent blocking UI editor
            return "";
        }

        const actualSize =
            fileData && typeof fileData.size === "number" && Number.isFinite(fileData.size) ? fileData.size : null;
        if ((actualSize !== null && actualSize > MAX_INLINE_BYTES) || (!hasKnownSize && actualSize === null)) {
            throw new Error("File too large for inline download. Use a signed URL instead.");
        }
        return await fileData.text();
    });
}

export async function getProjectFileSignedUrl(projectId: string, nodeId: string, ttlSeconds: number = 300, download: boolean = false) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const actorId = user?.id ?? null;
    const clampedTtl = Math.max(30, Math.min(3600, ttlSeconds));
    return await runInFlightDeduped(`files:signed-url:${projectId}:${nodeId}:${clampedTtl}:${actorId ?? "anon"}`, async () => {
        // Verify read access (works for public projects too)
        await assertProjectFileReadAccess(projectId, actorId);

        const node = await db.query.projectNodes.findFirst({
            where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
            columns: { s3Key: true, gitHash: true, mimeType: true }
        });

        if (!node) {
            throw new Error("File not found");
        }

        let currentS3Key = node.s3Key;

        // --- VIRTUAL FS HYDRATION ON READ ---
        if (!currentS3Key && node.gitHash) {
            const { projects, projectNodes } = await import("@/lib/db/schema");
            const project = await db.query.projects.findFirst({
                where: eq(projects.id, projectId),
                columns: { importSource: true }
            });
            const importSource = project?.importSource as any;
            if (importSource && importSource.type === "github" && importSource.repoUrl) {
                const urlParts = importSource.repoUrl.replace(/\/$/, '').split('/');
                const repoName = urlParts.pop();
                const ownerName = urlParts.pop();
                const apiUrl = `https://api.github.com/repos/${ownerName}/${repoName}/git/blobs/${node.gitHash}`;

                let headers: Record<string, string> = { 'Accept': 'application/vnd.github.v3+json' };
                const token = importSource.metadata?.importAuth || importSource.metadata?.githubToken;
                if (token) headers['Authorization'] = `Bearer ${token}`;

                const res = await fetch(apiUrl, { headers });
                if (res.ok) {
                    const data = await res.json();
                    let buffer: Buffer;
                    if (data.encoding === 'base64') {
                        buffer = Buffer.from(data.content, 'base64');
                    } else {
                        buffer = Buffer.from(data.content, 'utf8');
                    }

                    const adminClient = await createAdminClient();
                    const { buildProjectFileKey } = await import("@/lib/storage/project-file-key");
                    // We need the file's path for buildProjectFileKey.
                    // Wait, `node` doesn't have path selected! Let's just use the nodeId as a fallback.
                    // Or we just fetch the path!
                    const fullNode = await db.query.projectNodes.findFirst({
                        where: eq(projectNodes.id, nodeId),
                        columns: { path: true }
                    });
                    const s3Key = buildProjectFileKey(projectId, fullNode?.path || `virtual/${nodeId}`);

                    const { error: uploadError } = await adminClient.storage
                        .from('project-files')
                        .upload(s3Key, buffer, {
                            contentType: node.mimeType || 'application/octet-stream',
                            upsert: true
                        });

                    if (!uploadError) {
                        currentS3Key = s3Key;
                        await db.update(projectNodes).set({ s3Key }).where(eq(projectNodes.id, nodeId));
                    }
                }
            }
        }

        if (!currentS3Key) {
            throw new Error("File content not available yet");
        }
        const parsedKey = parseProjectFileKey(currentS3Key);
        if (!parsedKey || parsedKey.projectId !== projectId) {
            throw new Error("File key does not belong to this project");
        }

        // Use admin client to bypass storage policy edge-cases (public viewers).
        const adminClient = await createAdminClient();
        const { data, error } = await adminClient.storage
            .from("project-files")
            .createSignedUrl(currentS3Key, clampedTtl, { download });

        if (error) throw error;
        if (!data?.signedUrl) throw new Error("Failed to create signed URL");

        const now = Date.now();
        return { url: data.signedUrl, expiresAt: now + clampedTtl * 1000 };
    });
}

export async function getProjectFileSignedUrlBatch(
    projectId: string,
    nodeIds: string[],
    ttlSeconds: number = 300
): Promise<Record<string, { url: string; expiresAt: number }>> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const unique = Array.from(new Set(nodeIds)).filter((id) => UUID_RE.test(id));
    if (unique.length === 0) return {};
    if (unique.length > 50) throw new Error("Too many nodes requested. Max: 50");
    const actorId = user?.id ?? null;
    const stableIdsKey = unique.slice().sort().join(",");
    const clampedTtl = Math.max(30, Math.min(3600, ttlSeconds));

    return await runInFlightDeduped(`files:signed-url-batch:${projectId}:${stableIdsKey}:${clampedTtl}:${actorId ?? "anon"}`, async () => {
        await assertProjectFileReadAccess(projectId, actorId);

        const nodes = await db.query.projectNodes.findMany({
            where: and(eq(projectNodes.projectId, projectId), inArray(projectNodes.id, unique)),
            columns: { id: true, s3Key: true, gitHash: true, mimeType: true, path: true },
        });

        const adminClient = await createAdminClient();
        const now = Date.now();

        const entries = await Promise.all(
            nodes.map(async (node) => {
                let currentS3Key = node.s3Key;

                // --- VIRTUAL FS HYDRATION ---
                if (!currentS3Key && node.gitHash) {
                    const { projects, projectNodes } = await import("@/lib/db/schema");
                    const project = await db.query.projects.findFirst({
                        where: eq(projects.id, projectId),
                        columns: { importSource: true }
                    });
                    const importSource = project?.importSource as any;
                    if (importSource && importSource.type === "github" && importSource.repoUrl) {
                        const urlParts = importSource.repoUrl.replace(/\/$/, '').split('/');
                        const repoName = urlParts.pop();
                        const ownerName = urlParts.pop();
                        const apiUrl = `https://api.github.com/repos/${ownerName}/${repoName}/git/blobs/${node.gitHash}`;

                        let headers: Record<string, string> = { 'Accept': 'application/vnd.github.v3+json' };
                        const token = importSource.metadata?.importAuth || importSource.metadata?.githubToken;
                        if (token) headers['Authorization'] = `Bearer ${token}`;

                        const res = await fetch(apiUrl, { headers });
                        if (res.ok) {
                            const data = await res.json();
                            let buffer: Buffer;
                            if (data.encoding === 'base64') {
                                buffer = Buffer.from(data.content, 'base64');
                            } else {
                                buffer = Buffer.from(data.content, 'utf8');
                            }

                            const { buildProjectFileKey } = await import("@/lib/storage/project-file-key");
                            const s3Key = buildProjectFileKey(projectId, node.path || `virtual/${node.id}`);

                            const { error: uploadError } = await adminClient.storage
                                .from('project-files')
                                .upload(s3Key, buffer, {
                                    contentType: node.mimeType || 'application/octet-stream',
                                    upsert: true
                                });

                            if (!uploadError) {
                                currentS3Key = s3Key;
                                await db.update(projectNodes).set({ s3Key }).where(eq(projectNodes.id, node.id));
                            }
                        }
                    }
                }

                if (!currentS3Key) return null;
                const parsedKey = parseProjectFileKey(currentS3Key);
                if (!parsedKey || parsedKey.projectId !== projectId) return null;

                const { data, error } = await adminClient.storage
                    .from("project-files")
                    .createSignedUrl(currentS3Key, clampedTtl);
                if (error || !data?.signedUrl) return null;
                return [node.id, { url: data.signedUrl, expiresAt: now + clampedTtl * 1000 }] as const;
            })
        );

        return Object.fromEntries(entries.filter(Boolean) as Array<readonly [string, { url: string; expiresAt: number }]>);
    });
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

    const node = await db.transaction(async (tx) => {
        await assertProjectWriteAccessTx(tx, projectId, user.id);
        await assertNodeNotLockedByAnotherUser(projectId, nodeId, user.id, tx);

        const [updated] = await tx.update(projectNodes)
            .set({
                size: size,
                updatedAt: new Date()
            })
            .where(and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)))
            .returning();

        if (updated) {
            const versionNumber = updated.currentVersion ?? 1;
            await tx.update(fileVersions)
                .set({
                    size: size,
                    uploadedBy: user.id,
                    uploadedAt: new Date()
                })
                .where(and(eq(fileVersions.nodeId, nodeId), eq(fileVersions.version, versionNumber)));
        }

        return updated;
    });

    if (node) {
        const profile = await db.query.profiles.findFirst({
            where: eq(profiles.id, user.id),
            columns: { fullName: true, username: true, avatarUrl: true }
        });
        Object.assign(node, {
            updatedById: user.id,
            updatedByName: profile?.fullName ?? null,
            updatedByUsername: profile?.username ?? null,
            updatedByAvatarUrl: profile?.avatarUrl ?? null,
            versionUpdatedAt: node.updatedAt,
        });
    }

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
        if (!node) throw new Error("Node not found");
        return { success: true, data: node };
    } catch (error) {
        return {
            success: false,
            code: FILES_ERROR_CODES.UNKNOWN_ERROR,
            message: error instanceof Error ? error.message : "Failed to update file stats",
        };
    }
}

async function tryRecoverFromGitHub(projectId: string, nodePath: string | null): Promise<string | null> {
    if (!nodePath) return null;
    try {
        const { projects } = await import("@/lib/db/schema");
        const project = await db.query.projects.findFirst({
            where: eq(projects.id, projectId),
            columns: { importSource: true }
        });
        const importSource = project?.importSource as any;
        if (importSource && importSource.type === "github" && importSource.repoUrl) {
            const urlParts = importSource.repoUrl.replace(/\/$/, '').split('/');
            const repoName = urlParts.pop();
            const ownerName = urlParts.pop();
            const branch = importSource.branch || "main";
            const cleanPath = nodePath.startsWith("/") ? nodePath.slice(1) : nodePath;
            const apiUrl = `https://api.github.com/repos/${ownerName}/${repoName}/contents/${encodeURIComponent(cleanPath)}?ref=${branch}`;

            let headers: Record<string, string> = { 'Accept': 'application/vnd.github.v3+json' };
            const token = importSource.metadata?.importAuth || importSource.metadata?.githubToken;
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const res = await fetch(apiUrl, { headers });
            if (res.ok) {
                const data = await res.json();
                if (data.content) {
                    if (data.encoding === 'base64') {
                        return Buffer.from(data.content, 'base64').toString('utf8');
                    }
                    return data.content;
                }
            }
        }
    } catch (err) {
        console.error(`[tryRecoverFromGitHub] Recovery failed for path ${nodePath}:`, err);
    }
    return null;
}
