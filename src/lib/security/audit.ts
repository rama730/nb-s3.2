import { and, desc, eq, inArray } from "drizzle-orm";
import { buildPseudonymizedAuditRequestMetadata } from "@/lib/audit/request-metadata";
import { db } from "@/lib/db";
import { profileAuditEvents } from "@/lib/db/schema";
import { logger } from "@/lib/logger";

export const SECURITY_ACTIVITY_EVENT_TYPES = [
  "authenticator_app_enabled",
  "authenticator_app_removed",
  "recovery_codes_generated",
  "recovery_codes_regenerated",
  "recovery_code_used",
  // SEC-L7: failed recovery-code redemption attempts are audited so a user
  // can see when someone tried to redeem a code (useful signal that the
  // code sheet may have leaked). We never persist the submitted code or a
  // hash of it — only the fact, the failure reason, and the request fingerprint.
  "recovery_code_redemption_failed",
  "password_set",
  "password_changed",
  "other_sessions_revoked",
] as const;

export type SecurityActivityEventType = (typeof SECURITY_ACTIVITY_EVENT_TYPES)[number];

export type SecurityActivityEntry = {
  id: string;
  eventType: SecurityActivityEventType;
  createdAt: string;
  networkFingerprint?: string;
  deviceFingerprint?: string;
  metadata: Record<string, unknown>;
};

type SecurityAuditExecutor = Pick<typeof db, "insert">;
const SECURITY_AUDIT_MAX_ATTEMPTS = 2;
const SECURITY_AUDIT_RETRYABLE_CODES = new Set([
  "40001",
  "40P01",
  "53300",
  "57P03",
]);

function getDbErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const candidate = (error as { code?: unknown }).code;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

function isTransientAuditInsertError(error: unknown): boolean {
  const code = getDbErrorCode(error);
  if (code && SECURITY_AUDIT_RETRYABLE_CODES.has(code)) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return /timeout|timed out|connection reset|connection terminated|temporar|deadlock|serialization/i.test(error.message);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function recordSecurityEvent(input: {
  userId: string;
  eventType: SecurityActivityEventType;
  request: Request;
  metadata?: Record<string, unknown>;
  previousValue?: Record<string, unknown> | null;
  nextValue?: Record<string, unknown> | null;
  executor?: SecurityAuditExecutor;
}) {
  const requestMetadata = buildPseudonymizedAuditRequestMetadata(input.request);
  const auditPayload = {
    userId: input.userId,
    eventType: input.eventType,
    previousValue: input.previousValue ?? null,
    nextValue: input.nextValue ?? null,
    metadata: {
      ...(input.metadata ?? {}),
      ...requestMetadata,
    },
  };

  if (input.executor) {
    await input.executor.insert(profileAuditEvents).values(auditPayload);
    return;
  }

  for (let attempt = 1; attempt <= SECURITY_AUDIT_MAX_ATTEMPTS; attempt += 1) {
    try {
      // Operational basis: these rows power the user-visible security activity history.
      // Compliance boundary: store only keyed pseudonymous request fingerprints here, never raw
      // IP addresses or full user-agent strings. Account erasure deletes these rows explicitly.
      await db.insert(profileAuditEvents).values(auditPayload);
      return;
    } catch (error) {
      const code = getDbErrorCode(error);
      const retryable = attempt < SECURITY_AUDIT_MAX_ATTEMPTS && isTransientAuditInsertError(error);

      logger.error("security.audit.write_failed", {
        userId: input.userId,
        eventType: input.eventType,
        attempt,
        maxAttempts: SECURITY_AUDIT_MAX_ATTEMPTS,
        retryable,
        error: {
          message: error instanceof Error ? error.message : String(error),
          code,
        },
        errorCode: code,
        auditMetadata: auditPayload.metadata,
      });
      logger.metric("security.audit.write.failure", {
        userId: input.userId,
        eventType: input.eventType,
        attempt,
        retryable,
        errorCode: code ?? "unknown",
      });

      if (!retryable) {
        throw error;
      }

      await delay(50 * attempt);
    }
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
      networkFingerprint: typeof metadata.networkFingerprint === "string" ? metadata.networkFingerprint : undefined,
      deviceFingerprint: typeof metadata.deviceFingerprint === "string" ? metadata.deviceFingerprint : undefined,
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
