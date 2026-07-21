"use server";

import { getApplicationRequestHistory, type ApplicationRequestHistoryItem } from "@/app/actions/applications";
import { getConnectionRequestHistory, type ConnectionRequestHistoryItem, type HistoryFilters } from "@/app/actions/connections";

export type UnifiedRequestHistoryItem =
  | (ConnectionRequestHistoryItem & { source: "connection" })
  | (ApplicationRequestHistoryItem & { source: "application" });

export async function getUnifiedRequestHistory(limit: number, cursor?: string, filters?: HistoryFilters) {
  const [connections, applications] = await Promise.all([
    getConnectionRequestHistory(limit, cursor, filters),
    cursor ? Promise.resolve({ success: true as const, items: [] as ApplicationRequestHistoryItem[] }) : getApplicationRequestHistory(limit),
  ]);
  const failures = [
    !connections.success ? `connections: ${connections.error || "unknown error"}` : null,
    !applications.success ? `applications: ${applications.error || "unknown error"}` : null,
  ].filter((failure): failure is string => Boolean(failure));
  if (failures.length === 2) return { success: false as const, items: [], hasMore: false, nextCursor: null, error: failures.join("; ") };

  const items: UnifiedRequestHistoryItem[] = [
    ...(connections.success ? connections.items.map((item) => ({ ...item, source: "connection" as const })) : []),
    ...(applications.success ? applications.items.map((item) => ({ ...item, source: "application" as const })) : []),
  ].sort((a, b) => new Date(b.eventAt).getTime() - new Date(a.eventAt).getTime());

  return {
    success: true as const,
    items,
    hasMore: connections.success ? Boolean(connections.hasMore) : false,
    nextCursor: connections.success ? connections.nextCursor ?? null : null,
    warning: failures[0] ?? null,
  };
}
