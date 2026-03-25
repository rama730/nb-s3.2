import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { resolveCurrentSessionRowId } from "@/lib/security/session-current";

export type SecuritySessionActivity = {
    id: string;
    device_info: { userAgent: string };
    ip_address: string;
    last_active: string;
    created_at: string;
    is_current?: boolean;
    aal?: "aal1" | "aal2" | null;
};

export type SecurityLoginHistoryEntry = {
    id: string;
    ip_address: string;
    user_agent: string;
    created_at: string;
    location?: string;
    aal?: "aal1" | "aal2" | null;
};

function toIsoString(value: Date | string | null | undefined): string {
    if (!value) return new Date(0).toISOString();
    return typeof value === "string" ? value : value.toISOString();
}

export async function listActiveSessions(
    userId: string,
    currentSessionId?: string | null,
    limit: number = 10,
): Promise<SecuritySessionActivity[]> {
    const rows = await db.execute<{
        id: string;
        ip: string | null;
        user_agent: string | null;
        created_at: Date | string;
        updated_at: Date | string | null;
        refreshed_at: Date | string | null;
        aal: "aal1" | "aal2" | null;
    }>(sql`
      SELECT
        id::text AS id,
        ip::text AS ip,
        user_agent,
        created_at,
        updated_at,
        refreshed_at,
        aal::text AS aal
      FROM auth.sessions
      WHERE user_id = ${userId}::uuid
        AND (not_after IS NULL OR not_after > now())
      ORDER BY COALESCE(updated_at, created_at) DESC
      LIMIT ${limit}
    `);

    const resolvedCurrentSessionId = resolveCurrentSessionRowId(
        rows.map((row) => row.id),
        currentSessionId,
    );

    return rows.map((row) => ({
        id: row.id,
        device_info: { userAgent: row.user_agent?.trim() || "Unknown device" },
        ip_address: row.ip?.trim() || "unknown",
        created_at: toIsoString(row.created_at),
        last_active: toIsoString(row.updated_at || row.refreshed_at || row.created_at),
        is_current: resolvedCurrentSessionId ? row.id === resolvedCurrentSessionId : false,
        aal: row.aal,
    }));
}

export async function countOtherActiveSessions(
    userId: string,
    currentSessionId?: string | null,
): Promise<number> {
    const rows = currentSessionId
        ? await db.execute<{ count: number | string }>(sql`
          SELECT COUNT(*)::int AS count
          FROM auth.sessions
          WHERE user_id = ${userId}::uuid
            AND (not_after IS NULL OR not_after > now())
            AND id <> ${currentSessionId}::uuid
        `)
        : await db.execute<{ count: number | string }>(sql`
          SELECT COUNT(*)::int AS count
          FROM auth.sessions
          WHERE user_id = ${userId}::uuid
            AND (not_after IS NULL OR not_after > now())
        `);

    const value = Array.from(rows)[0]?.count;
    return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export async function listLoginHistory(
    userId: string,
    limit: number = 20,
): Promise<SecurityLoginHistoryEntry[]> {
    const rows = await db.execute<{
        id: string;
        ip: string | null;
        user_agent: string | null;
        created_at: Date | string;
        aal: "aal1" | "aal2" | null;
    }>(sql`
      SELECT
        id::text AS id,
        ip::text AS ip,
        user_agent,
        created_at,
        aal::text AS aal
      FROM auth.sessions
      WHERE user_id = ${userId}::uuid
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);

    return rows.map((row) => ({
        id: row.id,
        ip_address: row.ip?.trim() || "unknown",
        user_agent: row.user_agent?.trim() || "Unknown device",
        created_at: toIsoString(row.created_at),
        aal: row.aal,
    }));
}
