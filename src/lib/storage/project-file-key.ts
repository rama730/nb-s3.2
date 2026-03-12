const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const LEGACY_PROJECT_FILES_PREFIX = "projects";

export type ParsedProjectFileKey = {
  projectId: string;
  relativePath: string;
  format: "canonical" | "legacy";
};

function normalizePathPart(input: string): string {
  return (input || "").replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}

function hasUnsafePathSegment(relativePath: string): boolean {
  const segments = (relativePath || "").split("/").filter(Boolean);
  if (segments.length === 0) return true;
  return segments.some((segment) => {
    if (!segment) return true;
    if (segment === "." || segment === "..") return true;
    return /[\x00-\x1f]/.test(segment);
  });
}

export function normalizeProjectFileRelativePath(relativePath: string): string {
  return normalizePathPart(relativePath).replace(/^\.\//, "");
}

export function buildProjectFileKey(projectId: string, relativePath: string): string {
  const pid = (projectId || "").trim();
  const rel = normalizeProjectFileRelativePath(relativePath);
  if (!pid) throw new Error("projectId is required");
  if (!rel) throw new Error("relativePath is required");
  if (hasUnsafePathSegment(rel)) throw new Error("relativePath contains unsafe segments");
  return `${pid}/${rel}`;
}

export function parseProjectFileKey(key: string): ParsedProjectFileKey | null {
  const clean = normalizePathPart((key || "").trim());
  if (!clean) return null;

  const parts = clean.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  // Canonical: <projectId>/<path...>
  if (UUID_RE.test(parts[0])) {
    const relativePath = parts.slice(1).join("/");
    if (hasUnsafePathSegment(relativePath)) return null;
    return {
      projectId: parts[0],
      relativePath,
      format: "canonical",
    };
  }

  // Legacy: projects/<projectId>/<path...>
  if (parts[0] === LEGACY_PROJECT_FILES_PREFIX && parts.length >= 3 && UUID_RE.test(parts[1])) {
    const relativePath = parts.slice(2).join("/");
    if (hasUnsafePathSegment(relativePath)) return null;
    return {
      projectId: parts[1],
      relativePath,
      format: "legacy",
    };
  }

  return null;
}

export function parseProjectIdFromProjectFileKey(key: string): string | null {
  return parseProjectFileKey(key)?.projectId ?? null;
}

export function isCanonicalProjectFileKey(key: string): boolean {
  const parsed = parseProjectFileKey(key);
  return parsed?.format === "canonical";
}

export function toCanonicalProjectFileKey(key: string): string | null {
  const parsed = parseProjectFileKey(key);
  if (!parsed) return null;
  return buildProjectFileKey(parsed.projectId, parsed.relativePath);
}
