"use server";

import { db } from "@/lib/db";
import { profiles, projectNodeEvents, projectNodeLocks, projectNodes } from "@/lib/db/schema";
import { eq, and, sql, gt } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { runInFlightDeduped } from "@/lib/async/inflight-dedupe";
import {
    assertProjectReadAccess,
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

        const acquiredResult = await tx.execute<{
            nodeId: string;
            projectId: string;
            lockedBy: string;
            expiresAt: Date;
        }>(sql`
            INSERT INTO project_node_locks (node_id, project_id, locked_by, acquired_at, expires_at)
            VALUES (${nodeId}, ${projectId}, ${user.id}, ${now}, ${expiresAt})
            ON CONFLICT (node_id) DO UPDATE
            SET
                project_id = EXCLUDED.project_id,
                locked_by = EXCLUDED.locked_by,
                acquired_at = EXCLUDED.acquired_at,
                expires_at = EXCLUDED.expires_at
            WHERE
                project_node_locks.project_id = EXCLUDED.project_id
                AND (
                    project_node_locks.locked_by = EXCLUDED.locked_by
                    OR project_node_locks.expires_at <= ${now}
                )
            RETURNING
                node_id AS "nodeId",
                project_id AS "projectId",
                locked_by AS "lockedBy",
                expires_at AS "expiresAt"
        `);

        const acquiredRow = Array.from(acquiredResult)[0];
        if (!acquiredRow) {
            const existing = await tx.query.projectNodeLocks.findFirst({
                where: and(eq(projectNodeLocks.nodeId, nodeId), eq(projectNodeLocks.projectId, projectId)),
            });

            const lockUser = existing
                ? await tx.query.profiles.findFirst({
                    where: eq(profiles.id, existing.lockedBy),
                    columns: { id: true, username: true, fullName: true }
                })
                : null;

            return {
                ok: false as const,
                lock: {
                    nodeId,
                    projectId,
                    lockedBy: existing?.lockedBy ?? "",
                    lockedByName: lockUser?.fullName || lockUser?.username || null,
                    expiresAt: existing?.expiresAt.getTime() ?? expiresAt.getTime(),
                }
            };
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
                nodeId: acquiredRow.nodeId,
                projectId: acquiredRow.projectId,
                lockedBy: acquiredRow.lockedBy,
                lockedByName: null,
                expiresAt: acquiredRow.expiresAt.getTime(),
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
    const actorId = user?.id ?? null;
    return await runInFlightDeduped(`files:locks:${projectId}:${actorId ?? "anon"}`, async () => {
        await assertProjectReadAccess(projectId, actorId);
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
            .where(and(eq(projectNodeLocks.projectId, projectId), gt(projectNodeLocks.expiresAt, now)));

        return rows.map(r => ({
            nodeId: r.nodeId,
            projectId: r.projectId,
            lockedBy: r.lockedBy,
            lockedByName: r.fullName || r.username || null,
            expiresAt: r.expiresAt.getTime(),
        }));
    });
}
