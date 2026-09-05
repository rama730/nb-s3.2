import { createHmac, randomUUID } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { db, readDb } from "@/lib/db";
import { legalAcceptances } from "@/lib/db/schema";
import { CURRENT_LEGAL_ACCEPTANCE } from "@/lib/legal/versions";
import { getTrustedRequestIp } from "@/lib/security/request-ip";

const ACCEPTANCE_RETENTION_YEARS = 3;

function evidenceHash(value: string | null) {
  if (!value) return null;
  const configuredKey = process.env.AUDIT_METADATA_HASH_SECRET?.trim();
  if (!configuredKey && process.env.NODE_ENV === "production") {
    throw new Error("AUDIT_METADATA_HASH_SECRET must be configured in production");
  }
  const globalScope = globalThis as typeof globalThis & {
    __NB_LEGAL_EVIDENCE_HASH_SECRET__?: string;
  };
  globalScope.__NB_LEGAL_EVIDENCE_HASH_SECRET__ ||= randomUUID();
  const key = configuredKey ?? globalScope.__NB_LEGAL_EVIDENCE_HASH_SECRET__;
  return createHmac("sha256", key).update(value).digest("hex");
}

export async function recordCurrentLegalAcceptance(input: {
  userId: string;
  request: Request;
  context: "email_signup" | "oauth_signup" | "settings" | "material_update";
}) {
  const acceptedAt = new Date();
  const retentionExpiresAt = new Date(acceptedAt);
  retentionExpiresAt.setUTCFullYear(retentionExpiresAt.getUTCFullYear() + ACCEPTANCE_RETENTION_YEARS);
  const ip = getTrustedRequestIp(input.request);
  const userAgent = input.request.headers.get("user-agent");

  const [row] = await db
    .insert(legalAcceptances)
    .values({
      userId: input.userId,
      ...CURRENT_LEGAL_ACCEPTANCE,
      context: input.context,
      acceptedAt,
      retentionExpiresAt,
      evidence: {
        ipHash: evidenceHash(ip),
        userAgentHash: evidenceHash(userAgent),
        method: "affirmative_checkbox_or_button",
      },
    })
    .onConflictDoNothing()
    .returning();

  return row ?? null;
}

export async function getLegalAcceptanceState(userId: string) {
  const [latest] = await readDb
    .select({
      termsVersion: legalAcceptances.termsVersion,
      eulaVersion: legalAcceptances.eulaVersion,
      privacyNoticeVersion: legalAcceptances.privacyNoticeVersion,
      context: legalAcceptances.context,
      acceptedAt: legalAcceptances.acceptedAt,
      retentionExpiresAt: legalAcceptances.retentionExpiresAt,
    })
    .from(legalAcceptances)
    .where(eq(legalAcceptances.userId, userId))
    .orderBy(desc(legalAcceptances.acceptedAt))
    .limit(1);

  const current = latest
    ? latest.termsVersion === CURRENT_LEGAL_ACCEPTANCE.termsVersion
      && latest.eulaVersion === CURRENT_LEGAL_ACCEPTANCE.eulaVersion
      && latest.privacyNoticeVersion === CURRENT_LEGAL_ACCEPTANCE.privacyNoticeVersion
      && latest.retentionExpiresAt > new Date()
    : false;

  return { current, latest: latest ?? null, versions: CURRENT_LEGAL_ACCEPTANCE };
}

export async function hasCurrentLegalAcceptance(userId: string) {
  const [row] = await readDb
    .select({ id: legalAcceptances.id })
    .from(legalAcceptances)
    .where(and(
      eq(legalAcceptances.userId, userId),
      eq(legalAcceptances.termsVersion, CURRENT_LEGAL_ACCEPTANCE.termsVersion),
      eq(legalAcceptances.eulaVersion, CURRENT_LEGAL_ACCEPTANCE.eulaVersion),
      eq(legalAcceptances.privacyNoticeVersion, CURRENT_LEGAL_ACCEPTANCE.privacyNoticeVersion),
      gt(legalAcceptances.retentionExpiresAt, new Date()),
    ))
    .limit(1);
  return Boolean(row);
}
