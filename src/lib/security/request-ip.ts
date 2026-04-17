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
