import { createHmac } from "node:crypto";

type RequestWithNetworkHints = Request & {
  ip?: string | null;
  socket?: {
    remoteAddress?: string | null;
  } | null;
  connection?: {
    remoteAddress?: string | null;
  } | null;
};

function normalizeIpCandidate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function resolveAuditMetadataHashSecret(): string {
  const configuredSecret =
    process.env.AUDIT_METADATA_HASH_SECRET?.trim()
    || process.env.SECURITY_STEPUP_SECRET?.trim()
    || process.env.SUPABASE_JWT_SECRET?.trim();

  if (configuredSecret) return configuredSecret;

  if (process.env.NODE_ENV === "production") {
    throw new Error("AUDIT_METADATA_HASH_SECRET must be configured in production");
  }

  console.warn("[audit] using development fallback audit metadata hash secret; do not use in production");
  return "development-audit-metadata-secret";
}

function pseudonymizeAuditValue(scope: "network" | "device", value: string): string {
  return `${scope}_${createHmac("sha256", resolveAuditMetadataHashSecret())
    .update(`audit:${scope}:${value}`)
    .digest("hex")
    .slice(0, 16)}`;
}

export type PseudonymizedAuditRequestMetadata = {
  networkFingerprint?: string;
  deviceFingerprint?: string;
};

export function getInformationalRequestIp(request: Request): string | null {
  // Informational only: these values may come from proxy headers or runtime-specific hints
  // and must not be used for auth, authorization, rate limiting, or other security decisions.
  const requestWithNetworkHints = request as RequestWithNetworkHints;
  const remoteAddress =
    normalizeIpCandidate(requestWithNetworkHints.ip)
    ?? normalizeIpCandidate(requestWithNetworkHints.socket?.remoteAddress)
    ?? normalizeIpCandidate(requestWithNetworkHints.connection?.remoteAddress);
  if (remoteAddress) return remoteAddress;

  const realIp = normalizeIpCandidate(request.headers.get("x-real-ip"));
  if (realIp) return realIp;

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (!forwardedFor) return null;

  return normalizeIpCandidate(forwardedFor.split(",")[0]);
}

export function getRequestUserAgent(request: Request): string | null {
  const userAgent = request.headers.get("user-agent")?.trim();
  return userAgent || null;
}

export function buildPseudonymizedAuditRequestMetadata(request: Request): PseudonymizedAuditRequestMetadata {
  const ipAddress = getInformationalRequestIp(request);
  const userAgent = getRequestUserAgent(request);

  return {
    ...(ipAddress ? { networkFingerprint: pseudonymizeAuditValue("network", ipAddress) } : {}),
    ...(userAgent ? { deviceFingerprint: pseudonymizeAuditValue("device", userAgent) } : {}),
  };
}
