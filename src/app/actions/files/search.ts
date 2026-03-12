"use server";

import { db } from "@/lib/db";
import { projectFileIndex, projectNodes, projectNodeEvents } from "@/lib/db/schema";
import { eq, and, isNull, ilike, inArray, sql, desc } from "drizzle-orm";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { filesFeatureFlags } from "@/lib/features/files";
import { logger } from "@/lib/logger";
import {
    assertProjectReadAccess,
    assertProjectWriteAccess,
    assertNodeNotLockedByAnotherUser,
} from "./_shared";
import {
    normalizeSearchQuery,
    escapeLikePattern,
    countOccurrences,
    firstSnippet,
    MAX_BATCH_REPLACE_FILES,
    MAX_BATCH_REPLACE_TOTAL_BYTES,
} from "./_constants";

const PROJECT_SCALE_TTL_MS = 30_000;
const projectScaleCache = new Map<string, { count: number; ts: number }>();
const FILE_WRITE_ERROR_CODES = {
    KEY_FORMAT_INVALID: "KEY_FORMAT_INVALID",
    STORAGE_WRITE_FAILED: "STORAGE_WRITE_FAILED",
    DB_WRITE_FAILED: "DB_WRITE_FAILED",
    ROLLBACK_FAILED: "ROLLBACK_FAILED",
    VALIDATION_FAILED: "VALIDATION_FAILED",
} as const;

type FileWriteErrorCode = (typeof FILE_WRITE_ERROR_CODES)[keyof typeof FILE_WRITE_ERROR_CODES];

type FileWriteFailure = {
    success: false;
    code: FileWriteErrorCode;
    error: string;
};

type PlannedStorageWrite = {
    nodeName: string;
    s3Key: string;
    prevContent: string;
    nextContent: string;
};

function failFileWrite(code: FileWriteErrorCode, error: string): FileWriteFailure {
    return { success: false, code, error };
}

async function rollbackStorageWrites(
    entries: PlannedStorageWrite[],
    writeEntry: (s3Key: string, content: string) => Promise<{ error: { message?: string } | null }>
): Promise<{ ok: true } | { ok: false; failedNodeName: string }> {
    for (const entry of [...entries].reverse()) {
        const rollbackResult = await writeEntry(entry.s3Key, entry.prevContent);
        if (rollbackResult.error) {
            return { ok: false, failedNodeName: entry.nodeName };
        }
    }
    return { ok: true };
}

export async function upsertProjectFileIndex(projectId: string, nodeId: string, content: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectWriteAccess(projectId, user.id);

    // only index reasonably-sized text to avoid DB bloat
    const MAX_CHARS = 200_000;
    const safe = (content || "").slice(0, MAX_CHARS);

    // ensure node exists and belongs to project
    const node = await db.query.projectNodes.findFirst({
        where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
        columns: { id: true, type: true }
    });
    if (!node) throw new Error("File not found");
    if (node.type !== 'file') throw new Error("Not a file");

    await db
        .insert(projectFileIndex)
        .values({ nodeId, projectId, content: safe, updatedAt: new Date() })
        .onConflictDoUpdate({
            target: projectFileIndex.nodeId,
            set: { content: safe, updatedAt: new Date() },
        });
}

export async function searchProjectFileIndex(projectId: string, query: string, limit: number = 50) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    await assertProjectReadAccess(projectId, user?.id ?? null);

    const q = (query || "").trim();
    if (!q) return [] as Array<{ nodeId: string; snippet: string }>;
    const safeLimit = Math.min(200, Math.max(1, limit));
    const LARGE_PROJECT_THRESHOLD = 1000;

    let shouldUseHybrid = false;
    if (filesFeatureFlags.searchHybrid || filesFeatureFlags.wave2HybridSearch) {
        const cached = projectScaleCache.get(projectId);
        const now = Date.now();
        let projectNodeCount = cached && now - cached.ts < PROJECT_SCALE_TTL_MS ? cached.count : null;
        if (projectNodeCount === null) {
            const [projectScale] = await db
                .select({
                    count: sql<number>`count(*)::int`,
                })
                .from(projectNodes)
                .where(and(eq(projectNodes.projectId, projectId), isNull(projectNodes.deletedAt)));
            projectNodeCount = projectScale?.count ?? 0;
            projectScaleCache.set(projectId, { count: projectNodeCount, ts: now });
        }
        shouldUseHybrid = projectNodeCount >= LARGE_PROJECT_THRESHOLD;
    }

    if (shouldUseHybrid) {
        try {
            const hybridStartedAt = Date.now();
            const ranked = await db
                .select({
                    nodeId: projectFileIndex.nodeId,
                    snippet: sql<string>`substring(${projectFileIndex.content} from 1 for 240)`,
                    rank: sql<number>`ts_rank_cd(
                        to_tsvector('simple', coalesce(${projectFileIndex.content}, '')),
                        plainto_tsquery('simple', ${q})
                    )`,
                })
                .from(projectFileIndex)
                .where(
                    and(
                        eq(projectFileIndex.projectId, projectId),
                        sql<boolean>`to_tsvector('simple', coalesce(${projectFileIndex.content}, '')) @@ plainto_tsquery('simple', ${q})`
                    )
                )
                .orderBy((row) => desc(row.rank))
                .limit(safeLimit);

            const rows = ranked.map((row) => ({
                nodeId: row.nodeId,
                snippet: row.snippet,
            }));
            if (rows.length > 0) {
                logger.metric("files.search.hybrid.hit", {
                    projectId,
                    queryLength: q.length,
                    resultCount: rows.length,
                    latencyMs: Date.now() - hybridStartedAt,
                });
                return rows;
            }
            logger.metric("files.search.hybrid.empty", {
                projectId,
                queryLength: q.length,
                latencyMs: Date.now() - hybridStartedAt,
            });
        } catch {
            logger.metric("files.search.hybrid.error", {
                projectId,
                queryLength: q.length,
            });
            // Fall through to trgm/ilike path.
        }
    }

    const rows = await db
        .select({
            nodeId: projectFileIndex.nodeId,
            snippet: sql<string>`substring(${projectFileIndex.content} from 1 for 240)`,
        })
        .from(projectFileIndex)
        .where(and(eq(projectFileIndex.projectId, projectId), ilike(projectFileIndex.content, `%${escapeLikePattern(q)}%`)))
        .limit(safeLimit);

    const mapped = rows.map((r) => ({ nodeId: r.nodeId, snippet: r.snippet }));
    logger.metric("files.search.ilike.fallback", {
        projectId,
        queryLength: q.length,
        resultCount: mapped.length,
        usedHybridRoute: shouldUseHybrid,
    });
    return mapped;
}

export type FederatedNodeSearchResult = {
    nodeId: string;
    score: number;
    sources: Array<"name" | "content">;
    snippet: string | null;
};

export async function searchProjectNodesFederated(projectId: string, query: string, limit: number = 80) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    await assertProjectReadAccess(projectId, user?.id ?? null);

    const q = normalizeSearchQuery(query);
    if (!q || q.length < 2) return [] as FederatedNodeSearchResult[];

    const safeLimit = Math.min(200, Math.max(1, limit));

    const [nameRows, contentRows] = await Promise.all([
        db.query.projectNodes.findMany({
            where: and(
                eq(projectNodes.projectId, projectId),
                isNull(projectNodes.deletedAt),
                ilike(projectNodes.name, `%${escapeLikePattern(q)}%`)
            ),
            columns: { id: true, name: true },
            orderBy: (nodes, { asc }) => [asc(nodes.type), asc(nodes.name)],
            limit: safeLimit,
        }),
        searchProjectFileIndex(projectId, q, safeLimit),
    ]);

    const ranked = new Map<string, FederatedNodeSearchResult>();
    for (const row of nameRows) {
        const lower = row.name.toLowerCase();
        const exact = lower === q.toLowerCase();
        const starts = lower.startsWith(q.toLowerCase());
        ranked.set(row.id, {
            nodeId: row.id,
            score: exact ? 120 : starts ? 100 : 90,
            sources: ["name"],
            snippet: null,
        });
    }

    for (const row of contentRows) {
        const existing = ranked.get(row.nodeId);
        if (existing) {
            existing.score = Math.max(existing.score, 70);
            if (!existing.sources.includes("content")) existing.sources.push("content");
            if (!existing.snippet && row.snippet) existing.snippet = row.snippet;
            continue;
        }
        ranked.set(row.nodeId, {
            nodeId: row.nodeId,
            score: 60,
            sources: ["content"],
            snippet: row.snippet || null,
        });
    }

    return Array.from(ranked.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, safeLimit);
}

export async function previewProjectSearchReplace(
    projectId: string,
    query: string,
    replacement: string,
    limit: number = 120
) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    await assertProjectReadAccess(projectId, user?.id ?? null);

    const needle = normalizeSearchQuery(query);
    if (!needle || needle.length < 2) {
        return {
            success: true as const, items: [] as Array<{
                nodeId: string;
                name: string;
                parentId: string | null;
                occurrenceCount: number;
                beforeSnippet: string;
                afterSnippet: string;
            }>
        };
    }

    const safeLimit = Math.max(1, Math.min(MAX_BATCH_REPLACE_FILES, limit));
    const rows = await db
        .select({
            nodeId: projectNodes.id,
            name: projectNodes.name,
            parentId: projectNodes.parentId,
            content: projectFileIndex.content,
        })
        .from(projectFileIndex)
        .innerJoin(projectNodes, eq(projectNodes.id, projectFileIndex.nodeId))
        .where(
            and(
                eq(projectFileIndex.projectId, projectId),
                eq(projectNodes.projectId, projectId),
                isNull(projectNodes.deletedAt),
                ilike(projectFileIndex.content, `%${escapeLikePattern(needle)}%`)
            )
        )
        .limit(safeLimit);

    const items = rows
        .map((row) => {
            const occurrenceCount = countOccurrences(row.content || "", needle);
            if (occurrenceCount <= 0) return null;
            const beforeSnippet = firstSnippet(row.content || "", needle);
            const afterSnippet = beforeSnippet.split(needle).join(replacement);
            return {
                nodeId: row.nodeId,
                name: row.name,
                parentId: row.parentId,
                occurrenceCount,
                beforeSnippet,
                afterSnippet,
            };
        })
        .filter((row): row is NonNullable<typeof row> => !!row);

    return { success: true as const, items };
}

export async function applyProjectSearchReplace(
    projectId: string,
    input: { query: string; replacement: string; nodeIds: string[] }
) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectWriteAccess(projectId, user.id);

    const needle = normalizeSearchQuery(input.query);
    if (!needle || needle.length < 2) {
        return { success: false as const, error: "Search query must be at least 2 characters." };
    }

    const replacement = (input.replacement ?? "").slice(0, 5000);
    const uniqueNodeIds = Array.from(new Set((input.nodeIds || []).filter(Boolean))).slice(0, MAX_BATCH_REPLACE_FILES);
    if (uniqueNodeIds.length === 0) {
        return { success: false as const, error: "Select at least one file." };
    }

    const nodes = await db
        .select({
            id: projectNodes.id,
            name: projectNodes.name,
            s3Key: projectNodes.s3Key,
            type: projectNodes.type,
            deletedAt: projectNodes.deletedAt,
        })
        .from(projectNodes)
        .where(and(eq(projectNodes.projectId, projectId), inArray(projectNodes.id, uniqueNodeIds)));

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const validNodeIds = uniqueNodeIds.filter((id) => {
        const node = nodeById.get(id);
        return !!node && node.type === "file" && !!node.s3Key && !node.deletedAt;
    });
    if (validNodeIds.length === 0) {
        return { success: false as const, error: "No valid files selected." };
    }

    const indexRows = await db
        .select({
            nodeId: projectFileIndex.nodeId,
            content: projectFileIndex.content,
        })
        .from(projectFileIndex)
        .where(and(eq(projectFileIndex.projectId, projectId), inArray(projectFileIndex.nodeId, validNodeIds)));
    const contentByNodeId = new Map(indexRows.map((row) => [row.nodeId, row.content]));

    let totalBackupBytes = 0;
    const admin = await createAdminClient();
    const planned: Array<{
        nodeId: string;
        nodeName: string;
        s3Key: string;
        prevContent: string;
        nextContent: string;
        nextSize: number;
    }> = [];

    for (const nodeId of validNodeIds) {
        const node = nodeById.get(nodeId);
        if (!node?.s3Key) continue;
        const current = contentByNodeId.get(nodeId);
        if (typeof current !== "string" || !current.includes(needle)) continue;

        await assertNodeNotLockedByAnotherUser(projectId, nodeId, user.id);

        const next = current.split(needle).join(replacement);
        if (next === current) continue;

        totalBackupBytes += current.length;
        if (totalBackupBytes > MAX_BATCH_REPLACE_TOTAL_BYTES) {
            return failFileWrite(FILE_WRITE_ERROR_CODES.DB_WRITE_FAILED, "Replace payload too large. Select fewer files.");
        }

        planned.push({
            nodeId,
            nodeName: node.name,
            s3Key: node.s3Key,
            prevContent: current,
            nextContent: next,
            nextSize: new TextEncoder().encode(next).length,
        });
    }

    if (planned.length === 0) {
        return { success: true as const, changedNodeIds: [] as string[], backup: [] as Array<{ nodeId: string; content: string }> };
    }

    const writeEntry = async (s3Key: string, content: string) => {
        const blob = new Blob([content], { type: "text/plain" });
        return await admin.storage.from("project-files").update(s3Key, blob, { upsert: true });
    };

    const appliedStorage: typeof planned = [];
    for (const entry of planned) {
        const { error } = await writeEntry(entry.s3Key, entry.nextContent);
        if (error) {
            const rolledBack = await rollbackStorageWrites(appliedStorage, writeEntry);
            if (!rolledBack.ok) {
                logger.warn("files.replace.storage.rollback_failed", {
                    projectId,
                    failedNodeName: rolledBack.failedNodeName,
                    originalNodeName: entry.nodeName,
                });
                return failFileWrite(
                    FILE_WRITE_ERROR_CODES.ROLLBACK_FAILED,
                    `Failed writing ${entry.nodeName}; rollback failed at ${rolledBack.failedNodeName}`
                );
            }
            return failFileWrite(FILE_WRITE_ERROR_CODES.STORAGE_WRITE_FAILED, `Failed writing ${entry.nodeName}`);
        }
        appliedStorage.push(entry);
    }

    try {
        await db.transaction(async (tx) => {
            const now = new Date();
            for (const entry of planned) {
                await tx
                    .update(projectNodes)
                    .set({ size: entry.nextSize, updatedAt: now })
                    .where(and(eq(projectNodes.id, entry.nodeId), eq(projectNodes.projectId, projectId)));

                await tx
                    .insert(projectFileIndex)
                    .values({
                        projectId,
                        nodeId: entry.nodeId,
                        content: entry.nextContent,
                        updatedAt: now,
                    })
                    .onConflictDoUpdate({
                        target: projectFileIndex.nodeId,
                        set: { content: entry.nextContent, updatedAt: now },
                    });

                await tx.insert(projectNodeEvents).values({
                    projectId,
                    nodeId: entry.nodeId,
                    actorId: user.id,
                    type: "replace_batch",
                    metadata: { query: needle, replacementPreview: replacement.slice(0, 120) },
                    createdAt: now,
                });
            }
        });
    } catch {
        const rolledBack = await rollbackStorageWrites(planned, writeEntry);
        if (!rolledBack.ok) {
            logger.warn("files.replace.db.rollback_failed", {
                projectId,
                failedNodeName: rolledBack.failedNodeName,
            });
            return failFileWrite(
                FILE_WRITE_ERROR_CODES.ROLLBACK_FAILED,
                `Failed to persist replace operation; rollback failed at ${rolledBack.failedNodeName}.`
            );
        }
        return failFileWrite(FILE_WRITE_ERROR_CODES.DB_WRITE_FAILED, "Failed to persist replace operation.");
    }

    const changedNodeIds = planned.map((entry) => entry.nodeId);
    const backup = planned.map((entry) => ({ nodeId: entry.nodeId, content: entry.prevContent }));
    revalidatePath(`/projects/${projectId}`);
    return { success: true as const, changedNodeIds, backup };
}

export async function rollbackProjectSearchReplace(
    projectId: string,
    backups: Array<{ nodeId: string; content: string }>
) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await assertProjectWriteAccess(projectId, user.id);

    const entries = Array.from(new Map((backups || []).map((item) => [item.nodeId, item])).values())
        .slice(0, MAX_BATCH_REPLACE_FILES);
    if (entries.length === 0) {
        return failFileWrite(FILE_WRITE_ERROR_CODES.VALIDATION_FAILED, "Nothing to rollback.");
    }

    let totalBytes = 0;
    for (const entry of entries) totalBytes += entry.content?.length || 0;
    if (totalBytes > MAX_BATCH_REPLACE_TOTAL_BYTES) {
        return failFileWrite(FILE_WRITE_ERROR_CODES.VALIDATION_FAILED, "Rollback payload too large.");
    }

    const nodes = await db
        .select({
            id: projectNodes.id,
            name: projectNodes.name,
            s3Key: projectNodes.s3Key,
            type: projectNodes.type,
            deletedAt: projectNodes.deletedAt,
        })
        .from(projectNodes)
        .where(and(eq(projectNodes.projectId, projectId), inArray(projectNodes.id, entries.map((entry) => entry.nodeId))));

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const existingIndexRows = await db
        .select({
            nodeId: projectFileIndex.nodeId,
            content: projectFileIndex.content,
        })
        .from(projectFileIndex)
        .where(and(eq(projectFileIndex.projectId, projectId), inArray(projectFileIndex.nodeId, entries.map((entry) => entry.nodeId))));
    const existingContentByNodeId = new Map(existingIndexRows.map((row) => [row.nodeId, row.content]));

    const admin = await createAdminClient();
    const planned: Array<{
        nodeId: string;
        nodeName: string;
        s3Key: string;
        prevContent: string;
        nextContent: string;
        nextSize: number;
    }> = [];

    for (const entry of entries) {
        const node = nodeById.get(entry.nodeId);
        if (!node || node.type !== "file" || !node.s3Key || node.deletedAt) continue;

        await assertNodeNotLockedByAnotherUser(projectId, node.id, user.id);
        const nextContent = entry.content ?? "";
        planned.push({
            nodeId: node.id,
            nodeName: node.name,
            s3Key: node.s3Key,
            prevContent: existingContentByNodeId.get(node.id) ?? "",
            nextContent,
            nextSize: new TextEncoder().encode(nextContent).length,
        });
    }

    if (planned.length === 0) {
        return { success: true as const, restoredNodeIds: [] as string[] };
    }

    const writeEntry = async (s3Key: string, content: string) => {
        const blob = new Blob([content], { type: "text/plain" });
        return await admin.storage.from("project-files").update(s3Key, blob, { upsert: true });
    };

    const appliedStorage: typeof planned = [];
    for (const entry of planned) {
        const { error } = await writeEntry(entry.s3Key, entry.nextContent);
        if (error) {
            const rolledBack = await rollbackStorageWrites(appliedStorage, writeEntry);
            if (!rolledBack.ok) {
                logger.warn("files.rollback.storage.rollback_failed", {
                    projectId,
                    failedNodeName: rolledBack.failedNodeName,
                    originalNodeName: entry.nodeName,
                });
                return failFileWrite(
                    FILE_WRITE_ERROR_CODES.ROLLBACK_FAILED,
                    `Failed restoring ${entry.nodeName}; rollback failed at ${rolledBack.failedNodeName}`
                );
            }
            return failFileWrite(FILE_WRITE_ERROR_CODES.STORAGE_WRITE_FAILED, `Failed restoring ${entry.nodeName}`);
        }
        appliedStorage.push(entry);
    }

    try {
        await db.transaction(async (tx) => {
            const now = new Date();
            for (const entry of planned) {
                await tx
                    .update(projectNodes)
                    .set({ size: entry.nextSize, updatedAt: now })
                    .where(and(eq(projectNodes.id, entry.nodeId), eq(projectNodes.projectId, projectId)));

                await tx
                    .insert(projectFileIndex)
                    .values({
                        projectId,
                        nodeId: entry.nodeId,
                        content: entry.nextContent,
                        updatedAt: now,
                    })
                    .onConflictDoUpdate({
                        target: projectFileIndex.nodeId,
                        set: { content: entry.nextContent, updatedAt: now },
                    });

                await tx.insert(projectNodeEvents).values({
                    projectId,
                    nodeId: entry.nodeId,
                    actorId: user.id,
                    type: "replace_batch_rollback",
                    metadata: {},
                    createdAt: now,
                });
            }
        });
    } catch {
        const rolledBack = await rollbackStorageWrites(planned, writeEntry);
        if (!rolledBack.ok) {
            logger.warn("files.rollback.db.rollback_failed", {
                projectId,
                failedNodeName: rolledBack.failedNodeName,
            });
            return failFileWrite(
                FILE_WRITE_ERROR_CODES.ROLLBACK_FAILED,
                `Failed to persist rollback operation; rollback failed at ${rolledBack.failedNodeName}.`
            );
        }
        return failFileWrite(FILE_WRITE_ERROR_CODES.DB_WRITE_FAILED, "Failed to persist rollback operation.");
    }

    const restoredNodeIds = planned.map((entry) => entry.nodeId);
    revalidatePath(`/projects/${projectId}`);
    return { success: true as const, restoredNodeIds };
}
