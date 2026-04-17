/**
 * SEC-C5 / SEC-C6 / SEC-M12: single source of truth for user-provided URL
 * validation. Any URL that will eventually be rendered in an <img src>,
 * <a href>, <iframe src>, or fed back to another network request MUST pass
 * through `isSafeHttpUrl` (boolean gate) or `assertSafeHttpUrl` (throwing
 * variant). This blocks the common XSS/SSRF sinks:
 *   - javascript:, data:, vbscript:, file:, blob:, ftp:, ... (non-http schemes)
 *   - localhost / 127.0.0.1 / ::1 (loopback)
 *   - 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 (RFC1918)
 *   - 169.254.0.0/16 (link-local, e.g. AWS/GCP metadata 169.254.169.254)
 *   - 100.64.0.0/10 (carrier-grade NAT / Tailscale)
 *   - 0.0.0.0/8 (reserved)
 *
 * We intentionally keep this module synchronous and client-safe — it does NOT
 * resolve DNS and must not import any `node:*` modules. The file is pulled
 * into client bundles via `@/lib/profile/normalization` (EditProfileModal,
 * ProfileV2Client, ProfileRightRail) and `@/lib/validations/profile`, and
 * webpack cannot resolve `node:` URIs for the browser.
 *
 * For SSRF-sensitive callers (e.g. link-preview fetcher) a second DNS-resolving
 * pass must be layered on top because attackers can register a public domain
 * that resolves to a private IP ("DNS rebinding"). Use `assertPublicNetworkUrl`
 * / `fetchPublicUrlWithRedirectValidation` from `@/lib/security/outbound-url`
 * for that follow-up check — those live in a server-only module that
 * statically imports `node:dns/promises` and `node:net`.
 */

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

function isPrivateIpv4(host: string): boolean {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const [, a, b] = match.map((x) => Number(x)) as [number, number, number, number, number];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;

  // Reserved / this-network
  if (a === 0) return true;
  // Loopback
  if (a === 127) return true;
  // RFC1918 private
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  // Link-local (includes cloud metadata 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // Carrier-grade NAT
  if (a === 100 && b >= 64 && b <= 127) return true;
  // Benchmarking
  if (a === 198 && (b === 18 || b === 19)) return true;
  // Multicast / reserved
  if (a >= 224) return true;

  return false;
}

function isPrivateIpv6(host: string): boolean {
  // Strip brackets if URL class left them (shouldn't happen via `hostname`).
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // fc00::/7 unique-local
  if (h.startsWith("fe80:")) return true; // link-local
  // IPv4-mapped IPv6: ::ffff:a.b.c.d — check the embedded v4
  const mapped = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

function isPrivateHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "localhost") return true;
  if (lower.endsWith(".localhost")) return true;
  if (lower.endsWith(".local")) return true;
  if (lower.endsWith(".internal")) return true;
  if (isPrivateIpv4(lower)) return true;
  if (lower.includes(":") && isPrivateIpv6(lower)) return true;
  return false;
}

export interface SafeUrlOptions {
  /** Allow http:// in addition to https:// (default: true). */
  allowHttp?: boolean;
  /** Reject URLs with non-empty credentials in the userinfo (default: true). */
  rejectCredentials?: boolean;
  /** Reject URLs that target RFC1918 / loopback / link-local hosts (default: true). */
  blockPrivateHosts?: boolean;
  /** Cap URL length (default: 2048 — safe for most browsers and log sinks). */
  maxLength?: number;
}

function buildOptions(options?: SafeUrlOptions) {
  return {
    allowHttp: options?.allowHttp ?? true,
    rejectCredentials: options?.rejectCredentials ?? true,
    blockPrivateHosts: options?.blockPrivateHosts ?? true,
    maxLength: options?.maxLength ?? 2048,
  };
}

/**
 * Returns true if the input is a same-origin-safe http(s) URL. Returns false
 * for any non-string, malformed, dangerous-scheme, or private-host URL.
 */
export function isSafeHttpUrl(input: unknown, options?: SafeUrlOptions): input is string {
  if (typeof input !== "string") return false;
  const opts = buildOptions(options);
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > opts.maxLength) return false;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return false;
  if (!opts.allowHttp && url.protocol === "http:") return false;
  if (opts.rejectCredentials && (url.username || url.password)) return false;
  if (opts.blockPrivateHosts && isPrivateHostname(url.hostname)) return false;

  return true;
}

/**
 * Throwing variant. Returns the trimmed URL when valid. Intended for server
 * actions that want to surface a user-visible error message on bad input.
 */
export function assertSafeHttpUrl(input: unknown, options?: SafeUrlOptions): string {
  if (!isSafeHttpUrl(input, options)) {
    throw new Error("URL must be http(s) and point to a public host");
  }
  return (input as string).trim();
}

/**
 * Returns `null` for invalid URLs (useful when sanitising optional fields
 * without aborting the whole action). Otherwise returns the trimmed URL.
 */
export function sanitizeOptionalHttpUrl(
  input: unknown,
  options?: SafeUrlOptions,
): string | null {
  if (input === null || input === undefined || input === "") return null;
  return isSafeHttpUrl(input, options) ? (input as string).trim() : null;
}

// NOTE: the DNS-resolving SSRF check that used to live here (`resolvesToPublicHost`)
// was removed because (a) it forced webpack to pull `node:dns` into client
// bundles via the `@/lib/profile/normalization` → `ProfileV2Client` import
// chain, producing `UnhandledSchemeError: Reading from "node:dns" is not
// handled by plugins`, and (b) it had zero callers. Server-side callers
// should use `assertPublicNetworkUrl` from `@/lib/security/outbound-url`,
// which is the production SSRF/DNS-rebinding defense used by the link-preview
// route and lives in a server-only module.
