import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { profileAuditEvents } from "@/lib/db/schema";

export const PRIVACY_ACTIVITY_EVENT_TYPES = [
  "profile_visibility_changed",
  "message_privacy_changed",
  "connection_privacy_changed",
  "account_blocked",
  "account_unblocked",
] as const;

export type PrivacyActivityEventType = (typeof PRIVACY_ACTIVITY_EVENT_TYPES)[number];

export type PrivacyActivityEntry = {
  id: string;
  eventType: PrivacyActivityEventType;
  createdAt: string;
  previousValue: Record<string, unknown> | null;
  nextValue: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
};

function getRequestIp(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || null;
}

function getUserAgent(request: Request): string | null {
  const userAgent = request.headers.get("user-agent")?.trim();
  return userAgent || null;
}

export async function recordPrivacyEvent(input: {
  userId: string;
  eventType: PrivacyActivityEventType;
  request: Request;
  previousValue?: Record<string, unknown> | null;
  nextValue?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}) {
  const ipAddress = getRequestIp(input.request);
  const userAgent = getUserAgent(input.request);

  await db.insert(profileAuditEvents).values({
    userId: input.userId,
    eventType: input.eventType,
    previousValue: input.previousValue ?? null,
    nextValue: input.nextValue ?? null,
    metadata: {
      ...(input.metadata ?? {}),
      ...(ipAddress ? { ipAddress } : {}),
      ...(userAgent ? { userAgent } : {}),
    },
  });
}

export async function listPrivacyActivity(userId: string, limit: number = 20): Promise<PrivacyActivityEntry[]> {
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
    limit,
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
