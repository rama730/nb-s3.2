import type { ProjectNode } from "@/lib/db/schema";

export type FileKind = "folder" | "text" | "image" | "video" | "audio" | "pdf" | "doc" | "binary";

function extOf(name: string) {
  const parts = name.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "yml",
  "yaml",
  "toml",
  "xml",
  "csv",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "swift",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "cs",
  "php",
  "sql",
  "css",
  "scss",
  "html",
  "htm",
  "sh",
  "bash",
  "dockerfile",
  "gitignore",
]);

const DOC_MIME_PREFIXES = [
  "application/vnd.openxmlformats-officedocument",
  "application/vnd.ms-",
];

const DOC_MIMES = new Set([
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
]);

export function isTextLike(node: Pick<ProjectNode, "type" | "name" | "mimeType">): boolean {
  if (node.type !== "file") return false;
  const mime = (node.mimeType || "").toLowerCase();
  if (mime.startsWith("text/")) return true;
  if (mime === "application/json" || mime === "application/xml") return true;

  const ext = extOf(node.name);
  if (!ext) return false;
  return TEXT_EXTENSIONS.has(ext);
}

export function isAssetLike(node: Pick<ProjectNode, "type" | "name" | "mimeType">): boolean {
  if (node.type !== "file") return false;
  const mime = (node.mimeType || "").toLowerCase();

  if (mime.startsWith("image/")) return true;
  if (mime.startsWith("video/")) return true;
  if (mime.startsWith("audio/")) return true;
  if (mime === "application/pdf") return true;

  if (DOC_MIMES.has(mime)) return true;
  if (DOC_MIME_PREFIXES.some((p) => mime.startsWith(p))) return true;

  // If unknown mime but has an obviously-previewable extension, treat as asset.
  const ext = extOf(node.name);
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "mp4", "mov", "webm", "mp3", "wav", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(ext)) {
    return true;
  }

  return false;
}

export function fileKind(node: Pick<ProjectNode, "type" | "name" | "mimeType">): FileKind {
  if (node.type === "folder") return "folder";

  const mime = (node.mimeType || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";

  if (isTextLike(node)) return "text";

  const ext = extOf(node.name);
  if (DOC_MIMES.has(mime) || DOC_MIME_PREFIXES.some((p) => mime.startsWith(p))) return "doc";
  if (["doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(ext)) return "doc";

  return "binary";
}

