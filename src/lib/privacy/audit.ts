import { and, desc, eq, inArray } from "drizzle-orm";
import { buildPseudonymizedAuditRequestMetadata } from "@/lib/audit/request-metadata";
import { db } from "@/lib/db";
import { profileAuditEvents } from "@/lib/db/schema";

export const PRIVACY_ACTIVITY_EVENT_TYPES = [
  "profile_visibility_changed",
  "message_privacy_changed",
  "connection_privacy_changed",
  "account_blocked",
  "account_unblocked",
] as const;

export const PRIVACY_READ_EVENT_TYPES = [
  "profile_viewed",
  "discover_profile_served",
  "network_profile_served",
  "conversation_opened",
  "message_history_read",
] as const;

export type PrivacyActivityEventType = (typeof PRIVACY_ACTIVITY_EVENT_TYPES)[number];
export type PrivacyReadEventType = (typeof PRIVACY_READ_EVENT_TYPES)[number];

export type PrivacyActivityEntry = {
  id: string;
  eventType: PrivacyActivityEventType;
  createdAt: string;
  previousValue: Record<string, unknown> | null;
  nextValue: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
};

type PrivacyAuditExecutor = Pick<typeof db, "insert">;
const DEFAULT_PRIVACY_ACTIVITY_LIMIT = 20;
const MAX_PRIVACY_ACTIVITY_LIMIT = 100;

export async function recordPrivacyEvent(input: {
  userId: string;
  eventType: PrivacyActivityEventType;
  request: Request;
  previousValue?: Record<string, unknown> | null;
  nextValue?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  executor?: PrivacyAuditExecutor;
}) {
  const requestMetadata = buildPseudonymizedAuditRequestMetadata(input.request);

  // Operational basis: these rows power the user-visible privacy activity history.
  // Compliance boundary: store only keyed pseudonymous request fingerprints here, never raw
  // IP addresses or full user-agent strings. Account erasure deletes these rows explicitly.
  await (input.executor ?? db).insert(profileAuditEvents).values({
    userId: input.userId,
    eventType: input.eventType,
    previousValue: input.previousValue ?? null,
    nextValue: input.nextValue ?? null,
    metadata: {
      ...(input.metadata ?? {}),
      ...requestMetadata,
    },
  });
}

export async function listPrivacyActivity(userId: string, limit: number = 20): Promise<PrivacyActivityEntry[]> {
  const normalizedLimit = Number.isFinite(limit)
    ? Math.trunc(limit)
    : DEFAULT_PRIVACY_ACTIVITY_LIMIT;
  const safeLimit = Math.min(
    MAX_PRIVACY_ACTIVITY_LIMIT,
    Math.max(1, normalizedLimit),
  );

  const rows = await db.query.profileAuditEvents.findMany({
    columns: {
      id: true,
      eventType: true,
      createdAt: true,
      previousValue: true,
      nextValue: true,
      metadata: true,
    },
    where: and(
      eq(profileAuditEvents.userId, userId),
      inArray(profileAuditEvents.eventType, [...PRIVACY_ACTIVITY_EVENT_TYPES]),
    ),
    orderBy: [desc(profileAuditEvents.createdAt)],
    limit: safeLimit,
  });

  return rows.map((row) => ({
    id: row.id,
    eventType: row.eventType as PrivacyActivityEventType,
    createdAt: row.createdAt.toISOString(),
    previousValue: (row.previousValue as Record<string, unknown> | null) ?? null,
    nextValue: (row.nextValue as Record<string, unknown> | null) ?? null,
    metadata: row.metadata ?? {},
  }));
}

type PrivacyReadAuditExecutor = Pick<typeof db, "insert">;

export async function recordPrivacyReadEvent(input: {
  subjectUserId: string;
  viewerUserId: string;
  eventType: PrivacyReadEventType;
  route: string;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
  request?: Request;
  executor?: PrivacyReadAuditExecutor;
}) {
  const requestMetadata = input.request
    ? buildPseudonymizedAuditRequestMetadata(input.request)
    : {};

  await (input.executor ?? db).insert(profileAuditEvents).values({
    userId: input.subjectUserId,
    eventType: input.eventType,
    previousValue: null,
    nextValue: null,
    metadata: {
      viewerUserId: input.viewerUserId,
      route: input.route,
      requestId: input.requestId ?? null,
      ...(input.metadata ?? {}),
      ...requestMetadata,
    },
  });
}

export async function recordPrivacyReadEvents(input: {
  subjectUserIds: string[];
  viewerUserId: string;
  eventType: PrivacyReadEventType;
  route: string;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
  executor?: PrivacyReadAuditExecutor;
}) {
  const subjectUserIds = Array.from(new Set(input.subjectUserIds.filter(Boolean)));
  if (subjectUserIds.length === 0) return;

  await (input.executor ?? db).insert(profileAuditEvents).values(
    subjectUserIds.map((subjectUserId) => ({
      userId: subjectUserId,
      eventType: input.eventType,
      previousValue: null,
      nextValue: null,
      metadata: {
        viewerUserId: input.viewerUserId,
        route: input.route,
        requestId: input.requestId ?? null,
        ...(input.metadata ?? {}),
      },
    })),
  );
}
