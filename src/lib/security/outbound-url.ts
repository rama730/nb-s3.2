import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";
// @ts-expect-error Next bundles ipaddr.js without public type declarations.
import ipaddr from "next/dist/compiled/ipaddr.js/ipaddr.js";

const typedIpaddr = ipaddr as {
  parse(address: string): {
    kind(): string;
    isIPv4MappedAddress?(): boolean;
    toIPv4Address?(): { toString(): string };
  };
};

export class UnsafeOutboundUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeOutboundUrlError";
  }
}

type ResolveAddresses = (hostname: string) => Promise<string[]>;

const BLOCKED_HOSTNAME_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
]);

function normalizeHostname(hostname: string) {
  return hostname.trim().replace(/\.$/, "").toLowerCase();
}

function isBlockedHostname(hostname: string) {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return true;
  if (BLOCKED_HOSTNAMES.has(normalized)) return true;
  return BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function isPrivateIpv4(address: string) {
  const octets = address.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b, c] = octets;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;

  return false;
}

function isPrivateIpv6(address: string) {
  const normalized = address.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === "::" || normalized === "::1") return true;
  if (
    normalized.startsWith("fe8")
    || normalized.startsWith("fe9")
    || normalized.startsWith("fea")
    || normalized.startsWith("feb")
  ) {
    return true;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("ff")) return true;
  if (normalized.startsWith("2001:db8") || normalized.startsWith("2001:0db8")) return true;
  if (normalized.startsWith("2001::") || normalized.startsWith("2001:0:") || normalized.startsWith("2001:0000:")) {
    return true;
  }
  if (normalized.startsWith("2002:")) return true;
  if (normalized.startsWith("64:ff9b:")) return true;
  if (normalized === "100::" || normalized.startsWith("100:")) return true;

  try {
    const parsed = typedIpaddr.parse(normalized);
    if (parsed.kind() === "ipv6" && parsed.isIPv4MappedAddress?.()) {
      const mappedIpv4 = parsed.toIPv4Address?.().toString();
      if (mappedIpv4) {
        return isPrivateIpv4(mappedIpv4);
      }
    }
  } catch {
    // Fall through to the existing IPv6-only checks when parsing fails.
  }

  return false;
}

export function isBlockedIpAddress(address: string) {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

async function defaultResolveAddresses(hostname: string) {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

export async function assertPublicNetworkUrl(
  rawUrl: string | URL,
  options: {
    resolveAddresses?: ResolveAddresses;
    allowCredentials?: boolean;
  } = {},
) {
  const url = rawUrl instanceof URL ? new URL(rawUrl.toString()) : new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeOutboundUrlError("Only HTTP/HTTPS URLs are supported");
  }
  if (!options.allowCredentials && (url.username || url.password)) {
    throw new UnsafeOutboundUrlError("Credentialed URLs are not allowed");
  }

  const hostname = normalizeHostname(url.hostname);
  if (isBlockedHostname(hostname)) {
    throw new UnsafeOutboundUrlError("Local or internal network hosts are not allowed");
  }

  const resolveAddresses = options.resolveAddresses ?? defaultResolveAddresses;
  const addresses = net.isIP(hostname) ? [hostname] : await resolveAddresses(hostname);
  if (addresses.length === 0) {
    throw new UnsafeOutboundUrlError("Host could not be resolved");
  }
  if (addresses.some((address) => isBlockedIpAddress(address))) {
    throw new UnsafeOutboundUrlError("Local or private network addresses are not allowed");
  }

  return url;
}

export async function fetchPublicUrlWithRedirectValidation(
  input: {
    url: string | URL;
    init?: RequestInit;
    timeoutMs?: number;
    maxRedirects?: number;
    fetchImpl?: typeof fetch;
    resolveAddresses?: ResolveAddresses;
  },
) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = Math.max(250, input.timeoutMs ?? 5_000);
  const maxRedirects = Math.max(0, Math.min(input.maxRedirects ?? 3, 5));
  let currentUrl = await assertPublicNetworkUrl(input.url, {
    resolveAddresses: input.resolveAddresses,
  });

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const controller = new AbortController();
    const callerSignal = input.init?.signal;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let removeAbortListener: (() => void) | null = null;
    let requestSignal: AbortSignal = controller.signal;

    if (callerSignal) {
      if (typeof AbortSignal.any === "function") {
        requestSignal = AbortSignal.any([callerSignal, controller.signal]);
      } else if (callerSignal.aborted) {
        controller.abort();
      } else {
        const handleCallerAbort = () => controller.abort();
        callerSignal.addEventListener("abort", handleCallerAbort, { once: true });
        removeAbortListener = () => callerSignal.removeEventListener("abort", handleCallerAbort);
      }
    }

    let response: Response;
    try {
      response = await fetchImpl(currentUrl, {
        ...input.init,
        redirect: "manual",
        signal: requestSignal,
      });
    } finally {
      clearTimeout(timeout);
      removeAbortListener?.();
    }

    const location = response.headers.get("location");
    const isRedirect = response.status >= 300 && response.status < 400 && Boolean(location);
    if (!isRedirect) {
      return { response, resolvedUrl: currentUrl };
    }
    if (redirectCount >= maxRedirects) {
      throw new UnsafeOutboundUrlError("Too many redirects");
    }

    currentUrl = await assertPublicNetworkUrl(new URL(location!, currentUrl), {
      resolveAddresses: input.resolveAddresses,
    });
  }

  throw new UnsafeOutboundUrlError("Too many redirects");
}
