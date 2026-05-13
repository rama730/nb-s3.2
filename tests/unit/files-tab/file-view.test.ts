// Task 6.1 acceptance test — `FileView` preview-picker helpers.
//
// Validates: Req 5.5–5.7, Req 13.1–13.5, Req 13.6, Req 17.1–17.4.
//
// jsdom is not installed in this repo. Following the pattern used by
// tests/unit/files-tab/sidebar.test.ts, we exercise the pure helpers
// directly and assert the structural contract against the source file
// as a text contract. The full render-time behaviours (empty-media
// placeholder, preview error, error-boundary fallback) are covered by
// Task 6.5 once the shared testing shell is in place.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { ProjectNode } from "@/lib/db/schema";
import { fileKind } from "@/components/projects/v2/utils/fileKind";
import {
  isAssetKind,
  isEmptyMedia,
  isMarkdownNode,
} from "@/components/projects/v2/files-tab/file/previewPicker";

// ---------------------------------------------------------------------------
// Fixture builder
// ---------------------------------------------------------------------------

type NodeInit = {
  name: string;
  mimeType?: string | null;
  size?: number | null;
};

function file(init: NodeInit): ProjectNode {
  return {
    id: "n1",
    projectId: "proj-1",
    parentId: null,
    path: "/",
    type: "file",
    name: init.name,
    s3Key: "s3/n1",
    size: init.size ?? 100,
    mimeType: init.mimeType ?? null,
    currentVersion: 1,
    metadata: {},
    gitHash: null,
    createdBy: null,
    deletedBy: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    deletedAt: null,
  } as ProjectNode;
}

// ---------------------------------------------------------------------------
// isMarkdownNode — Req 5.5, Req 13.5
// ---------------------------------------------------------------------------

describe("FileView / isMarkdownNode (Req 5.5, Req 13.5)", () => {
  it("recognises .md as markdown", () => {
    assert.equal(isMarkdownNode({ name: "README.md" }), true);
  });

  it("recognises .markdown as markdown", () => {
    assert.equal(isMarkdownNode({ name: "notes.markdown" }), true);
  });

  it("is case-insensitive on the extension", () => {
    assert.equal(isMarkdownNode({ name: "README.MD" }), true);
    assert.equal(isMarkdownNode({ name: "NOTES.Markdown" }), true);
  });

  it("rejects files that merely contain `md` in the basename", () => {
    assert.equal(isMarkdownNode({ name: "embedmd.txt" }), false);
    assert.equal(isMarkdownNode({ name: "mdx.tsx" }), false);
  });

  it("rejects files without an extension", () => {
    assert.equal(isMarkdownNode({ name: "README" }), false);
  });
});

// ---------------------------------------------------------------------------
// isEmptyMedia — Req 5.6
// ---------------------------------------------------------------------------

describe("FileView / isEmptyMedia (Req 5.6)", () => {
  it("flags 0-byte images / videos / audio", () => {
    assert.equal(isEmptyMedia({ size: 0 }, "image"), true);
    assert.equal(isEmptyMedia({ size: 0 }, "video"), true);
    assert.equal(isEmptyMedia({ size: 0 }, "audio"), true);
  });

  it("does NOT flag 0-byte PDFs / docs / text / binaries (Req 5.6 scope)", () => {
    assert.equal(isEmptyMedia({ size: 0 }, "pdf"), false);
    assert.equal(isEmptyMedia({ size: 0 }, "doc"), false);
    assert.equal(isEmptyMedia({ size: 0 }, "text"), false);
    assert.equal(isEmptyMedia({ size: 0 }, "binary"), false);
  });

  it("does NOT flag non-zero-byte media", () => {
    assert.equal(isEmptyMedia({ size: 1 }, "image"), false);
    assert.equal(isEmptyMedia({ size: 1024 }, "video"), false);
    assert.equal(isEmptyMedia({ size: 1 }, "audio"), false);
  });

  it("treats null / undefined size as non-empty (do not show placeholder for unknown size)", () => {
    assert.equal(isEmptyMedia({ size: null }, "image"), false);
    assert.equal(isEmptyMedia({ size: undefined as unknown as number }, "image"), false);
  });
});

// ---------------------------------------------------------------------------
// isAssetKind — Req 13.1–13.4
// ---------------------------------------------------------------------------

describe("FileView / isAssetKind (Req 13.1-13.4)", () => {
  it("matches image / video / audio / pdf / doc", () => {
    for (const k of ["image", "video", "audio", "pdf", "doc"] as const) {
      assert.equal(isAssetKind(k), true, `expected ${k} to be an asset kind`);
    }
  });

  it("excludes text / binary / folder", () => {
    for (const k of ["text", "binary", "folder"] as const) {
      assert.equal(isAssetKind(k), false, `expected ${k} NOT to be an asset kind`);
    }
  });
});

// ---------------------------------------------------------------------------
// Integration with fileKind — Req 13.1–13.5
// ---------------------------------------------------------------------------

describe("FileView / preview dispatch (Req 13.1-13.5) — fileKind + picker agreement", () => {
  it("image MIME routes through isAssetKind", () => {
    assert.equal(isAssetKind(fileKind(file({ name: "a.png", mimeType: "image/png" }))), true);
  });

  it("video MIME routes through isAssetKind", () => {
    assert.equal(isAssetKind(fileKind(file({ name: "v.mp4", mimeType: "video/mp4" }))), true);
  });

  it("audio MIME routes through isAssetKind", () => {
    assert.equal(isAssetKind(fileKind(file({ name: "a.mp3", mimeType: "audio/mpeg" }))), true);
  });

  it("PDF MIME routes through isAssetKind", () => {
    assert.equal(isAssetKind(fileKind(file({ name: "doc.pdf", mimeType: "application/pdf" }))), true);
  });

  it("Word docs route through isAssetKind (doc kind)", () => {
    assert.equal(
      isAssetKind(
        fileKind(
          file({
            name: "report.docx",
            mimeType:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          }),
        ),
      ),
      true,
    );
  });

  it("Markdown is NOT an asset kind — routed to MarkdownPreview", () => {
    const node = file({ name: "README.md", mimeType: "text/markdown" });
    assert.equal(isAssetKind(fileKind(node)), false);
    assert.equal(isMarkdownNode(node), true);
  });

  it("Plain text is NOT an asset kind — routed to TextViewer", () => {
    const node = file({ name: "hello.txt", mimeType: "text/plain" });
    assert.equal(isAssetKind(fileKind(node)), false);
    assert.equal(fileKind(node), "text");
  });

  it("Unknown binary is NOT an asset kind — routed to BinaryFallback", () => {
    const node = file({ name: "blob.bin", mimeType: "application/octet-stream" });
    assert.equal(isAssetKind(fileKind(node)), false);
    assert.equal(fileKind(node), "binary");
  });
});

// ---------------------------------------------------------------------------
// Structural contract — Req 17.1-17.4 and Req 13.6
// ---------------------------------------------------------------------------
//
// The Req 17 fix depends on the parent (`FilesTabMain`) keying this
// component by `currentLocation.id`. `FileView` itself has two structural
// guarantees we can verify at the source level without rendering:
//   (a) MetadataStrip is rendered unconditionally inside `FileView` so it
//       remains visible even when the preview region surfaces an error
//       (Req 13.6).
//   (b) The preview region is wrapped in `ComponentErrorBoundary` so
//       render-time failures fall back to an error indicator without
//       tearing down `MetadataStrip` (Req 13.6).

describe("FileView — structural contract (Req 13.6, Req 17.1-17.4)", () => {
  const source = readFileSync(
    path.resolve(
      process.cwd(),
      "src/components/projects/v2/files-tab/file/FileView.tsx",
    ),
    "utf8",
  );

  it("renders MetadataStrip inside FileView (so it stays visible on preview errors — Req 13.6)", () => {
    assert.match(
      source,
      /<MetadataStrip\b/,
      "FileView must render MetadataStrip (Req 5.1, Req 13.6)",
    );
  });

  it("wraps the preview region in ComponentErrorBoundary (Req 13.6)", () => {
    assert.match(
      source,
      /<ComponentErrorBoundary\b/,
      "FileView must wrap the preview region in a ComponentErrorBoundary so render-time failures keep MetadataStrip visible (Req 13.6)",
    );
  });

  it("imports AssetPreview and MarkdownPreview from the preview folder (reused unchanged)", () => {
    assert.match(
      source,
      /from\s+"\.\.\/\.\.\/preview\/AssetPreview"/,
      "AssetPreview must be reused from src/components/projects/v2/preview/AssetPreview.tsx (design § FileView)",
    );
    assert.match(
      source,
      /from\s+"\.\.\/\.\.\/preview\/MarkdownPreview"/,
      "MarkdownPreview must be reused from src/components/projects/v2/preview/MarkdownPreview.tsx (design § FileView)",
    );
  });

  it("does NOT import AssetMetadataPanel (replaced structurally by MetadataStrip — Req 17)", () => {
    assert.doesNotMatch(
      source,
      /AssetMetadataPanel/,
      "AssetMetadataPanel is NOT reused — it is replaced by MetadataStrip as part of the Req 17 fix (design § FileView)",
    );
  });
});
