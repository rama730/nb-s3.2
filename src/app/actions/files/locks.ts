"use server";

import { db } from "@/lib/db";
import { profiles, projectNodeEvents, projectNodeLocks, projectNodes } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import {
    assertProjectWriteAccess,
    recordNodeEvent,
} from "./_shared";
import {
    FILES_ERROR_CODES,
    type FilesActionResult,
} from "./_constants";

export async function acquireProjectNodeLock(projectId: string, nodeId: string, ttlSeconds: number = 120) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectWriteAccess(projectId, user.id);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    return await db.transaction(async (tx) => {
        // Ensure node belongs to project
        const node = await tx.query.projectNodes.findFirst({
            where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
            columns: { id: true }
        });
        if (!node) throw new Error("File not found");

        const existing = await tx.query.projectNodeLocks.findFirst({
            where: and(eq(projectNodeLocks.nodeId, nodeId), eq(projectNodeLocks.projectId, projectId)),
        });

        if (existing && existing.expiresAt > now && existing.lockedBy !== user.id) {
            const lockUser = await tx.query.profiles.findFirst({
                where: eq(profiles.id, existing.lockedBy),
                columns: { id: true, username: true, fullName: true }
            });
            return {
                ok: false as const,
                lock: {
                    nodeId,
                    projectId,
                    lockedBy: existing.lockedBy,
                    lockedByName: lockUser?.fullName || lockUser?.username || null,
                    expiresAt: existing.expiresAt.getTime(),
                }
            };
        }

        if (existing) {
            await tx.update(projectNodeLocks)
                .set({ lockedBy: user.id, acquiredAt: now, expiresAt })
                .where(and(eq(projectNodeLocks.nodeId, nodeId), eq(projectNodeLocks.projectId, projectId)));
        } else {
            await tx.insert(projectNodeLocks).values({
                nodeId,
                projectId,
                lockedBy: user.id,
                acquiredAt: now,
                expiresAt,
            });
        }

        await tx.insert(projectNodeEvents).values({
            projectId,
            nodeId,
            actorId: user.id,
            type: 'lock_acquire',
            metadata: { expiresAt: expiresAt.toISOString() },
            createdAt: now,
        });

        return {
            ok: true as const,
            lock: {
                nodeId,
                projectId,
                lockedBy: user.id,
                lockedByName: null,
                expiresAt: expiresAt.getTime(),
            }
        };
    });
}

export async function acquireProjectNodeLockSafe(
    projectId: string,
    nodeId: string,
    ttlSeconds: number = 120
): Promise<FilesActionResult<Awaited<ReturnType<typeof acquireProjectNodeLock>>>> {
    try {
        const data = await acquireProjectNodeLock(projectId, nodeId, ttlSeconds);
        return { success: true, data };
    } catch (error) {
        return {
            success: false,
            code: FILES_ERROR_CODES.UNKNOWN_ERROR,
            message: error instanceof Error ? error.message : "Failed to acquire lock",
        };
    }
}

export async function refreshProjectNodeLock(projectId: string, nodeId: string, ttlSeconds: number = 120) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectWriteAccess(projectId, user.id);

    const clampedTtl = Math.min(3600, Math.max(30, ttlSeconds));
    const now = new Date();
    const expiresAt = new Date(now.getTime() + clampedTtl * 1000);

    return await db.transaction(async (tx) => {
        const existing = await tx.query.projectNodeLocks.findFirst({
            where: and(eq(projectNodeLocks.nodeId, nodeId), eq(projectNodeLocks.projectId, projectId)),
        });

        if (!existing) return { ok: false as const, reason: "missing" as const };
        if (existing.lockedBy !== user.id) return { ok: false as const, reason: "not_owner" as const };

        await tx.update(projectNodeLocks)
            .set({ expiresAt })
            .where(and(eq(projectNodeLocks.nodeId, nodeId), eq(projectNodeLocks.projectId, projectId)));

        return { ok: true as const, expiresAt: expiresAt.getTime() };
    });
}

export async function releaseProjectNodeLock(projectId: string, nodeId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectWriteAccess(projectId, user.id);

    await db.delete(projectNodeLocks).where(
        and(
            eq(projectNodeLocks.projectId, projectId),
            eq(projectNodeLocks.nodeId, nodeId),
            eq(projectNodeLocks.lockedBy, user.id)
        )
    );

    await recordNodeEvent(projectId, user.id, nodeId, 'lock_release', {});
}

export async function getProjectLocks(projectId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    // This is read-only metadata; allow any project member to fetch.
    const now = new Date();

    const rows = await db
        .select({
            nodeId: projectNodeLocks.nodeId,
            projectId: projectNodeLocks.projectId,
            lockedBy: projectNodeLocks.lockedBy,
            expiresAt: projectNodeLocks.expiresAt,
            username: profiles.username,
            fullName: profiles.fullName,
        })
        .from(projectNodeLocks)
        .leftJoin(profiles, eq(projectNodeLocks.lockedBy, profiles.id))
        .where(and(eq(projectNodeLocks.projectId, projectId), sql`${projectNodeLocks.expiresAt} > ${now}`));

    return rows.map(r => ({
        nodeId: r.nodeId,
        projectId: r.projectId,
        lockedBy: r.lockedBy,
        lockedByName: r.fullName || r.username || null,
        expiresAt: r.expiresAt.getTime(),
    }));
}
