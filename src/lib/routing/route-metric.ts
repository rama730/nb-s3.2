const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPAQUE_SEGMENT = /^(?:[0-9]+|[0-9a-f]{16,})$/i;

const SAFE_STATIC_SEGMENTS = new Set([
  "account",
  "admin",
  "api",
  "applications",
  "attachments",
  "auth",
  "authorize",
  "callback",
  "collaboration-summary",
  "completion",
  "contributions",
  "delete",
  "doc-assets",
  "doc-collaboration-token",
  "files",
  "forgot-password",
  "go",
  "heartbeat",
  "hub",
  "image",
  "locks",
  "login",
  "messages",
  "monitor",
  "new",
  "notifications",
  "onboarding",
  "people",
  "presence",
  "privacy",
  "profile",
  "profiles",
  "projects",
  "reset-password",
  "security",
  "session",
  "settings",
  "signup",
  "skills",
  "update-media",
  "u",
  "username-check",
  "v1",
  "verify-email",
  "webhooks",
  "workspace",
]);

/**
 * Convert a request path into a bounded-cardinality telemetry label.
 * Unknown path segments are deliberately replaced so usernames, project
 * slugs, database identifiers, and storage keys cannot enter metrics.
 */
export function toPrivacySafeRouteMetric(pathname: string | null | undefined): string {
  if (!pathname || pathname === "/") return "/";

  const cleanPath = pathname.split("?", 1)[0] ?? "/";
  const segments = cleanPath.split("/").filter(Boolean).slice(0, 6);
  if (segments.length === 0) return "/";

  const normalized = segments.map((segment) => {
    const lowered = segment.toLowerCase();
    if (lowered === ":dynamic" || lowered === ":id") return lowered;
    if (SAFE_STATIC_SEGMENTS.has(lowered)) return lowered;
    if (UUID_SEGMENT.test(segment) || OPAQUE_SEGMENT.test(segment)) return ":id";
    return ":dynamic";
  });

  return `/${normalized.join("/")}`;
}
