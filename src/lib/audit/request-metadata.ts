import { createHmac, randomUUID } from "node:crypto";
import { getTrustedRequestIp } from "@/lib/security/request-ip";

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
  const configuredSecret = process.env.AUDIT_METADATA_HASH_SECRET?.trim();

  if (configuredSecret) return configuredSecret;

  if (process.env.NODE_ENV === "production") {
    throw new Error("AUDIT_METADATA_HASH_SECRET must be configured in production");
  }

  const globalScope = globalThis as typeof globalThis & {
    __NB_AUDIT_METADATA_HASH_SECRET__?: string;
  };
  globalScope.__NB_AUDIT_METADATA_HASH_SECRET__ ||= randomUUID();
  console.warn("[audit] using ephemeral development audit metadata hash secret; do not use in production");
  return globalScope.__NB_AUDIT_METADATA_HASH_SECRET__;
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
  const trustedRequestIp = getTrustedRequestIp(request);
  if (trustedRequestIp) return trustedRequestIp;

  // Informational only: these values may come from proxy headers or runtime-specific hints
  // and must not be used for auth, authorization, rate limiting, or other security decisions.
  const requestWithNetworkHints = request as RequestWithNetworkHints;
  const remoteAddress =
    normalizeIpCandidate(requestWithNetworkHints.ip)
    ?? normalizeIpCandidate(requestWithNetworkHints.socket?.remoteAddress)
    ?? normalizeIpCandidate(requestWithNetworkHints.connection?.remoteAddress);
  return remoteAddress;
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
