const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
const SAFE_MIME_TOP_LEVEL = new Set(["application", "text", "image", "video", "audio", "font"]);
const BLOCKED_MIME_TYPES = new Set([
  "multipart/form-data",
  "application/x-msdownload",
  "application/x-dosexec",
  "application/x-msdos-program",
]);

const DEFAULT_PROJECT_UPLOAD_MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB
const DEFAULT_ATTACHMENT_UPLOAD_MAX_FILE_BYTES = 50 * 1024 * 1024; // 50MB
const MAX_UPLOAD_PATH_LENGTH = 1024;
const MAX_PATH_SEGMENT_LENGTH = 255;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt((value || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export const PROJECT_UPLOAD_MAX_FILE_BYTES = parsePositiveInt(
  process.env.PROJECT_UPLOAD_MAX_FILE_BYTES,
  DEFAULT_PROJECT_UPLOAD_MAX_FILE_BYTES,
);

export const ATTACHMENT_UPLOAD_MAX_FILE_BYTES = parsePositiveInt(
  process.env.ATTACHMENT_UPLOAD_MAX_FILE_BYTES,
  DEFAULT_ATTACHMENT_UPLOAD_MAX_FILE_BYTES,
);

export function normalizeAndValidateMimeType(rawMimeType: unknown): string {
  const normalized = typeof rawMimeType === "string" ? rawMimeType.trim().toLowerCase() : "";
  if (!normalized) return "application/octet-stream";
  if (normalized.length > 255 || !MIME_PATTERN.test(normalized)) {
    throw new Error("Invalid MIME type");
  }

  const [topLevel] = normalized.split("/");
  if (!SAFE_MIME_TOP_LEVEL.has(topLevel)) {
    throw new Error("Unsupported MIME type");
  }
  if (BLOCKED_MIME_TYPES.has(normalized)) {
    throw new Error("Blocked MIME type");
  }

  return normalized;
}

export function normalizeAndValidateFileSize(
  rawSize: unknown,
  maxBytes: number,
  label = "File",
): number {
  const size = typeof rawSize === "number" ? rawSize : Number(rawSize);
  if (!Number.isFinite(size) || size < 0) {
    throw new Error(`${label} size is invalid`);
  }
  const normalized = Math.floor(size);
  if (normalized > maxBytes) {
    const mb = Math.floor(maxBytes / (1024 * 1024));
    throw new Error(`${label} exceeds maximum size of ${mb}MB`);
  }
  return normalized;
}

export function normalizeAndValidateUploadRelativePath(rawPath: unknown): string {
  const normalized = typeof rawPath === "string" ? rawPath.replaceAll("\\", "/").trim() : "";
  const withoutLeadingSlash = normalized.replace(/^\/+/, "");
  if (!withoutLeadingSlash) {
    throw new Error("Relative path is required");
  }
  if (withoutLeadingSlash.length > MAX_UPLOAD_PATH_LENGTH) {
    throw new Error("Relative path is too long");
  }

  const segments = withoutLeadingSlash.split("/").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) {
    throw new Error("Relative path is required");
  }

  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      throw new Error("Relative path contains invalid traversal segment");
    }
    if (segment.length > MAX_PATH_SEGMENT_LENGTH) {
      throw new Error("Relative path segment is too long");
    }
    if (/[\x00-\x1f]/.test(segment)) {
      throw new Error("Relative path contains control characters");
    }
  }

  return segments.join("/");
}
