const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
const SAFE_MIME_TOP_LEVEL = new Set(["application", "text", "image", "video", "audio", "font"]);
const BLOCKED_MIME_TYPES = new Set([
  "multipart/form-data",
  "application/x-msdownload",
  "application/x-dosexec",
  "application/x-msdos-program",
  "application/svg+xml",
  "image/svg+xml",
]);

const MAGIC_BYTE_CHECKERS: Record<string, (bytes: Uint8Array) => boolean> = {
  "image/png": (bytes) =>
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a,
  "image/jpeg": (bytes) =>
    bytes.length >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff,
  "image/gif": (bytes) =>
    bytes.length >= 6
    && ((bytes[0] === 0x47
      && bytes[1] === 0x49
      && bytes[2] === 0x46
      && bytes[3] === 0x38
      && bytes[4] === 0x37
      && bytes[5] === 0x61)
      || (bytes[0] === 0x47
        && bytes[1] === 0x49
        && bytes[2] === 0x46
        && bytes[3] === 0x38
        && bytes[4] === 0x39
        && bytes[5] === 0x61)),
  "image/webp": (bytes) =>
    bytes.length >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50,
  "application/pdf": (bytes) =>
    bytes.length >= 4
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46,
};

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

async function validateMagicBytes(
  source: { arrayBuffer(): Promise<ArrayBuffer>; size: number },
  mimeType: string,
): Promise<void> {
  const checker = MAGIC_BYTE_CHECKERS[mimeType];
  if (!checker) return;

  const bytesToRead = Math.min(Math.max(Number(source.size) || 0, 16), 32);
  const buffer = await source.arrayBuffer();
  const signature = new Uint8Array(buffer.slice(0, bytesToRead));
  if (!checker(signature)) {
    throw new Error("File contents do not match the declared MIME type");
  }
}

export async function validateUploadedFileMagicBytes(
  file: Pick<File, "arrayBuffer" | "size">,
  mimeType: string,
): Promise<void> {
  await validateMagicBytes(file, mimeType);
}

export async function validateUploadedBlobMagicBytes(
  blob: Pick<Blob, "arrayBuffer" | "size">,
  mimeType: string,
): Promise<void> {
  await validateMagicBytes(blob, mimeType);
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
