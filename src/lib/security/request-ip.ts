type HeaderReader = Pick<Headers, "get">;

type RequestWithNetworkHints = Request & {
  ip?: string | null;
  socket?: {
    remoteAddress?: string | null;
  } | null;
  connection?: {
    remoteAddress?: string | null;
  } | null;
};

const TRUSTED_PROXY_MARKER_HEADERS = [
  "x-vercel-id",
  "cf-ray",
  "fly-request-id",
  "x-amzn-trace-id",
] as const;

function normalizeIpCandidate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function hasTrustedProxyMarker(headers: HeaderReader): boolean {
  if (process.env.NODE_ENV !== "production") {
    return true;
  }

  return TRUSTED_PROXY_MARKER_HEADERS.some((headerName) => {
    const value = headers.get(headerName);
    return typeof value === "string" && value.trim().length > 0;
  });
}

function resolveForwardedIp(headers: HeaderReader): string | null {
  if (!hasTrustedProxyMarker(headers)) return null;

  const realIp = normalizeIpCandidate(headers.get("x-real-ip"));
  if (realIp) return realIp;

  const forwardedFor = headers.get("x-forwarded-for");
  if (!forwardedFor) return null;

  return normalizeIpCandidate(forwardedFor.split(",")[0]);
}

export function getTrustedHeadersIp(headers: HeaderReader): string | null {
  return resolveForwardedIp(headers);
}

export function getTrustedRequestIp(request: Request): string | null {
  const hintedRequest = request as RequestWithNetworkHints;
  const directIp =
    normalizeIpCandidate(hintedRequest.ip)
    ?? normalizeIpCandidate(hintedRequest.socket?.remoteAddress)
    ?? normalizeIpCandidate(hintedRequest.connection?.remoteAddress);
  if (directIp) return directIp;

  return resolveForwardedIp(request.headers);
}

export function getTrustedSubnet(ip: string | null | undefined): string {
  if (!ip || ip === "unknown") return "unknown-subnet";
  const trimmed = ip.trim();
  if (trimmed.includes(".")) {
    const parts = trimmed.split(".");
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
    }
  }
  if (trimmed.includes(":")) {
    const parts = trimmed.split(":");
    if (parts.length >= 4) {
      return `${parts.slice(0, 4).join(":")}::/64`;
    }
  }
  return trimmed;
}
