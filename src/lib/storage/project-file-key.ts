import { isUuid } from "@/lib/validations/uuid";

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

  const firstPart = parts[0];
  if (!firstPart) return null;

  // Canonical: <projectId>/<path...>
  if (isUuid(firstPart)) {
    const relativePath = parts.slice(1).join("/");
    if (hasUnsafePathSegment(relativePath)) return null;
    return {
      projectId: firstPart,
      relativePath,
      format: "canonical",
    };
  }

  // Legacy: projects/<projectId>/<path...>
  const secondPart = parts[1];
  if (firstPart === LEGACY_PROJECT_FILES_PREFIX && parts.length >= 3 && secondPart && isUuid(secondPart)) {
    const relativePath = parts.slice(2).join("/");
    if (hasUnsafePathSegment(relativePath)) return null;
    return {
      projectId: secondPart,
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
