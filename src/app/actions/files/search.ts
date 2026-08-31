"use server";

import { db } from "@/lib/db";
import { projectFileIndex, projectNodes } from "@/lib/db/schema";
import { eq, and, isNull, ilike, sql, asc } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { filesFeatureFlags } from "@/lib/features/files";
import { logger } from "@/lib/logger";
import {
    assertProjectFileReadAccess,
    assertProjectWriteAccess,
} from "@/lib/files/internal-helpers";
import {
    normalizeSearchQuery,
    escapeLikePattern,
} from "./_constants";

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

async function searchProjectFileIndexAuthorized(projectId: string, query: string, limit: number = 50) {
    const q = (query || "").trim();
    if (!q) return [] as Array<{ nodeId: string; snippet: string }>;
    const safeLimit = Math.min(200, Math.max(1, limit));
    const LARGE_PROJECT_THRESHOLD = 1000;

    // Always use GIN-indexed trigram ilike search to prevent CPU spikes and table scans
    const shouldUseHybrid = false;

    const rows = await db
        .select({
            nodeId: projectFileIndex.nodeId,
            snippet: sql<string>`substring(${projectFileIndex.content} from 1 for 240)`,
        })
        .from(projectFileIndex)
        .innerJoin(
            projectNodes,
            and(
                eq(projectNodes.id, projectFileIndex.nodeId),
                eq(projectNodes.projectId, projectFileIndex.projectId),
            ),
        )
        .where(and(
            eq(projectFileIndex.projectId, projectId),
            isNull(projectNodes.deletedAt),
            ilike(projectFileIndex.content, `%${escapeLikePattern(q)}%`),
        ))
        .orderBy(asc(projectNodes.path), asc(projectNodes.id))
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

export async function searchProjectFileIndex(projectId: string, query: string, limit: number = 50) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    await assertProjectFileReadAccess(projectId, user?.id ?? null);
    return searchProjectFileIndexAuthorized(projectId, query, limit);
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
    await assertProjectFileReadAccess(projectId, user?.id ?? null);

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
        searchProjectFileIndexAuthorized(projectId, q, safeLimit),
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
