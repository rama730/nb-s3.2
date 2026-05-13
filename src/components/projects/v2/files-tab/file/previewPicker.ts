// Pure helpers extracted from `FileView.tsx` so unit tests can import
// them without pulling the server-action / supabase graph through the
// transitive import chain.
//
// Requirements: Req 5.5, Req 5.6, Req 13.1–13.5.
// See design.md § FileView / `pickPreview` for the authoritative contract.

import type { ProjectNode } from "@/lib/db/schema";

import type { FileKind } from "../../utils/fileKind";

// ---------------------------------------------------------------------------
// Extension helpers
// ---------------------------------------------------------------------------

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);

function extOf(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

/**
 * Req 5.5 / Req 13.5: treat `.md` and `.markdown` as the markdown kind.
 * Case-insensitive match on the extension only — files with "md" in the
 * basename (e.g. `embedmd.txt`) are NOT markdown.
 */
export function isMarkdownNode(node: Pick<ProjectNode, "name">): boolean {
  return MARKDOWN_EXTENSIONS.has(extOf(node.name));
}

// ---------------------------------------------------------------------------
// Empty-media predicate — Req 5.6
// ---------------------------------------------------------------------------

/**
 * Req 5.6: image / video / audio with `size === 0` render an empty-media
 * placeholder instead of attempting a real preview.
 *
 * Intentionally strict: `null` / `undefined` size is NOT treated as
 * empty so unknown-size media does not trigger a placeholder. Only an
 * explicit zero qualifies. PDFs, docs, text and binaries are excluded
 * per the requirement text.
 */
export function isEmptyMedia(
  node: Pick<ProjectNode, "size">,
  kind: FileKind,
): boolean {
  if (node.size !== 0) return false;
  return kind === "image" || kind === "video" || kind === "audio";
}

// ---------------------------------------------------------------------------
// Asset-kind predicate — Req 13.1–13.4
// ---------------------------------------------------------------------------

/**
 * Kinds that flow into `AssetPreview` unchanged. `text` and `binary`
 * are excluded (they route to `TextViewer` and `BinaryFallback`).
 */
export function isAssetKind(kind: FileKind): boolean {
  return (
    kind === "image" ||
    kind === "video" ||
    kind === "audio" ||
    kind === "pdf" ||
    kind === "doc"
  );
}
