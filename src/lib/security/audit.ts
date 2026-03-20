import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { profileAuditEvents } from "@/lib/db/schema";

export const SECURITY_ACTIVITY_EVENT_TYPES = [
  "authenticator_app_enabled",
  "authenticator_app_removed",
  "recovery_codes_generated",
  "recovery_codes_regenerated",
  "recovery_code_used",
  "password_set",
  "password_changed",
  "other_sessions_revoked",
] as const;

export type SecurityActivityEventType = (typeof SECURITY_ACTIVITY_EVENT_TYPES)[number];

export type SecurityActivityEntry = {
  id: string;
  eventType: SecurityActivityEventType;
  createdAt: string;
  ipAddress?: string;
  userAgent?: string;
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

export async function recordSecurityEvent(input: {
  userId: string;
  eventType: SecurityActivityEventType;
  request: Request;
  metadata?: Record<string, unknown>;
  previousValue?: Record<string, unknown> | null;
  nextValue?: Record<string, unknown> | null;
}) {
  const ipAddress = getRequestIp(input.request);
  const userAgent = getUserAgent(input.request);

  try {
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
  } catch (error) {
    console.warn("[security-audit] insert failed", error);
  }
}

export async function listSecurityActivity(
  userId: string,
  limit: number = 20,
): Promise<SecurityActivityEntry[]> {
  const rows = await db.query.profileAuditEvents.findMany({
    columns: {
      id: true,
      eventType: true,
      createdAt: true,
      metadata: true,
    },
    where: and(
      eq(profileAuditEvents.userId, userId),
      inArray(profileAuditEvents.eventType, [...SECURITY_ACTIVITY_EVENT_TYPES]),
    ),
    orderBy: [desc(profileAuditEvents.createdAt)],
    limit,
  });

  return rows.map((row) => {
    const metadata = row.metadata ?? {};
    return {
      id: row.id,
      eventType: row.eventType as SecurityActivityEventType,
      createdAt: row.createdAt.toISOString(),
      ipAddress: typeof metadata.ipAddress === "string" ? metadata.ipAddress : undefined,
      userAgent: typeof metadata.userAgent === "string" ? metadata.userAgent : undefined,
      metadata,
    };
  });
}

export async function getLatestPasswordChangeAt(userId: string): Promise<string | undefined> {
  const latest = await db.query.profileAuditEvents.findFirst({
    columns: {
      createdAt: true,
    },
    where: and(
      eq(profileAuditEvents.userId, userId),
      inArray(profileAuditEvents.eventType, ["password_set", "password_changed"]),
    ),
    orderBy: [desc(profileAuditEvents.createdAt)],
  });

  return latest?.createdAt.toISOString();
}
