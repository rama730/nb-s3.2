"use server";

import { getApplicationRequestHistory, type ApplicationRequestHistoryItem } from "@/app/actions/applications";
import { getConnectionRequestHistory, type ConnectionRequestHistoryItem, type HistoryFilters } from "@/app/actions/connections";

export type UnifiedRequestHistoryItem =
  | (ConnectionRequestHistoryItem & { source: "connection" })
  | (ApplicationRequestHistoryItem & { source: "application" });

type UnifiedHistoryCursor = {
  connectionCursor: string | null;
  applicationCursor: string | null;
};

function parseUnifiedHistoryCursor(cursor?: string): UnifiedHistoryCursor {
  if (!cursor) return { connectionCursor: null, applicationCursor: null };
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<UnifiedHistoryCursor>;
    return {
      connectionCursor: typeof parsed.connectionCursor === "string" ? parsed.connectionCursor : null,
      applicationCursor: typeof parsed.applicationCursor === "string" ? parsed.applicationCursor : null,
    };
  } catch {
    return { connectionCursor: null, applicationCursor: null };
  }
}

export async function getUnifiedRequestHistory(limit: number, cursor?: string, filters?: HistoryFilters) {
  const effectiveLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
  const sourceCursor = parseUnifiedHistoryCursor(cursor);
  const [connections, applications] = await Promise.all([
    getConnectionRequestHistory(effectiveLimit, sourceCursor.connectionCursor ?? undefined, filters),
    getApplicationRequestHistory(effectiveLimit, sourceCursor.applicationCursor ?? undefined),
  ]);
  const failures = [
    !connections.success ? `connections: ${connections.error || "unknown error"}` : null,
    !applications.success ? `applications: ${applications.error || "unknown error"}` : null,
  ].filter((failure): failure is string => Boolean(failure));
  if (failures.length === 2) return { success: false as const, items: [], hasMore: false, nextCursor: null, error: failures.join("; ") };

  const candidates: UnifiedRequestHistoryItem[] = [
    ...(connections.success ? connections.items.map((item) => ({ ...item, source: "connection" as const })) : []),
    ...(applications.success ? applications.items.map((item) => ({ ...item, source: "application" as const })) : []),
  ].sort((a, b) =>
    new Date(b.eventAt).getTime() - new Date(a.eventAt).getTime()
    || b.source.localeCompare(a.source)
    || b.id.localeCompare(a.id),
  );
  const items = candidates.slice(0, effectiveLimit);
  const lastConnection = [...items].reverse().find((item) => item.source === "connection");
  const lastApplication = [...items].reverse().find((item) => item.source === "application");
  const connectionCursor = lastConnection
    ? `${lastConnection.eventAt}|${lastConnection.id}`
    : sourceCursor.connectionCursor;
  const applicationCursor = lastApplication
    ? `${lastApplication.eventAt}|${lastApplication.id}`
    : sourceCursor.applicationCursor;
  const hasMore = candidates.length > effectiveLimit
    || (connections.success && Boolean(connections.hasMore))
    || (applications.success && Boolean(applications.hasMore));
  const nextCursor = hasMore
    ? Buffer.from(JSON.stringify({ connectionCursor, applicationCursor }), "utf8").toString("base64url")
    : null;

  return {
    success: true as const,
    items,
    hasMore,
    nextCursor,
    warning: failures[0] ?? null,
  };
}
