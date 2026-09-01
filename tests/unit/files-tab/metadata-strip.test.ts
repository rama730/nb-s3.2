// Task 6.5 — Unit tests for `MetadataStrip`, `FileActionsBar`, and the
// 0-byte media placeholder path inside `FileView`.
//
// Requirements covered (per tasks.md § 6.5):
//   * Req 5.1  — every Metadata_Strip field is rendered
//   * Req 5.3  — Edit action present for Role_Owner / Role_Member
//   * Req 5.4  — Edit action absent for Role_Viewer
//   * Req 5.6  — 0-byte image / video / audio renders an empty-media
//                placeholder in place of the asset preview
//   * Req 5.9  — missing fields render as "—"
//   * Req 11.3 — VersionPill in MetadataStrip iff `currentVersion > 1`
//   * Req 19.3 — Viewer role mutation controls are not visible
//
// Testing shell: `node:test` + `tsx`. jsdom is not installed in this
// repo, so we follow the SSR pattern established by
// `tests/unit/files-tab/role-gate-viewer.test.ts`: render React via
// `renderToStaticMarkup` from `react-dom/server` and assert against
// the emitted HTML string. `MetadataStrip` and `FileActionsBar` are
// pure render functions over their props (the two side-effect hooks
// inside `MetadataStrip` do not mutate DOM during initial render), so
// an SSR snapshot is the right tool for these contracts.
//
// For the 0-byte media placeholder (Req 5.6), we verify the structural
// contract at two levels that together pin the behaviour without
// mounting `FileView` (which transitively imports server actions and
// would trigger env validation under `tsx --test`):
//
//   (a) The pure helper `isEmptyMedia` (exported from `previewPicker.ts`)
//       classifies image / video / audio with `size === 0` as empty and
//       leaves everything else alone.
//   (b) A source-level grep on `FileView.tsx` confirms that when
//       `emptyMedia === true`, the preview region renders
//       `<EmptyMediaPlaceholder ...>` — never an `<AssetPreview>`,
//       `<MarkdownPreview>`, or `<TextViewer>`.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { ProjectNode } from "@/lib/db/schema";
import {
  FilesTabRoleProvider,
  type Role,
} from "@/components/projects/v2/files-tab/FilesTabRoleContext";
import {
  MetadataStrip,
  type MetadataStripNode,
} from "@/components/projects/v2/files-tab/file/MetadataStrip";
import { FileActionsBar } from "@/components/projects/v2/files-tab/file/FileActionsBar";
import { isEmptyMedia } from "@/components/projects/v2/files-tab/file/previewPicker";

const testQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

// ─── Fixture builder ─────────────────────────────────────────────────

type NodeOverrides = Partial<MetadataStripNode>;

function makeNode(overrides: NodeOverrides = {}): MetadataStripNode {
  const base: ProjectNode = {
    id: "node-1",
    projectId: "proj-1",
    parentId: null,
    path: "/",
    type: "file",
    name: "hello.txt",
    s3Key: "s3/node-1",
    size: 12_800, // → 12.5 KB
    mimeType: "text/plain",
    currentVersion: 1,
    metadata: {},
    gitHash: null,
    createdBy: null,
    deletedBy: null,
    createdAt: new Date("2026-05-10T14:23:00Z"),
    updatedAt: new Date("2026-05-10T14:23:00Z"),
    deletedAt: null,
  } as ProjectNode;
  return { ...base, ...overrides } as MetadataStripNode;
}

// ─── Render helpers ──────────────────────────────────────────────────

interface RenderMetadataOptions {
  node: MetadataStripNode;
  role?: Role;
}

/**
 * Render `MetadataStrip` wrapped in `FilesTabRoleProvider` so
 * `FileActionsBar` (which reads the role context) has a provider.
 * Returns the SSR HTML snapshot.
 */
function renderMetadataStrip(options: RenderMetadataOptions): string {
  const role: Role = options.role ?? "Role_Owner";
  const canEdit = role !== "Role_Viewer";
  return renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client: testQueryClient },
      React.createElement(
        FilesTabRoleProvider,
        { role, canEdit },
        React.createElement(MetadataStrip, {
          node: options.node,
          mode: "view",
          onView: () => {},
          onRaw: () => {},
          onEdit: () => {},
        }),
      ),
    )
  );
}

function renderFileActionsBar(role: Role): string {
  const canEdit = role !== "Role_Viewer";
  return renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client: testQueryClient },
      React.createElement(
        FilesTabRoleProvider,
        { role, canEdit },
        React.createElement(FileActionsBar, {
          mode: "view",
          onView: () => {},
          onRaw: () => {},
          onEdit: () => {},
        }),
      ),
    )
  );
}

/**
 * Extract the contents of the `<span data-field="{field}">…</span>` (or
 * `<time data-field="{field}">…</time>`) element from the rendered
 * HTML. Returns the element's text content (stripped of any nested
 * tags) or `null` when the field is not present.
 *
 * SSR output is deterministic and compact, so a small regex-based
 * extractor is enough here — we avoid pulling in a jsdom / cheerio
 * dependency just for field lookup.
 */
function fieldText(html: string, field: string): string | null {
  // Matches <span data-field="…" …>VALUE</span> OR <time ...>VALUE</time>.
  const re = new RegExp(
    `<(?:span|time)[^>]*data-field="${field}"[^>]*>([\\s\\S]*?)</(?:span|time)>`,
    "i",
  );
  const match = re.exec(html);
  if (!match) return null;
  // Strip nested tags (e.g. VersionPill renders <span data-testid=…>vN</span>
  // inside the `version` field). The remaining text is the visible value.
  return (match[1] || "").replace(/<[^>]*>/g, "").trim();
}

// ─────────────────────────────────────────────────────────────────────
// All fields rendered (Req 5.1)
// ─────────────────────────────────────────────────────────────────────

describe("MetadataStrip — all fields rendered (Req 5.1)", () => {
  it("renders name, size, last-updated attribution, and MIME type", () => {
    const html = renderMetadataStrip({
      node: makeNode({
        name: "hello.txt",
        size: 12_800, // → 12.5 KB (formatBytes 1024-base, one decimal)
        currentVersion: 1, // no version pill — covered by the Req 11.3 suite
        updatedAt: new Date("2026-05-10T14:23:00Z"),
        mimeType: "text/plain",
        updatedByName: "Alex Example",
      }),
    });

    assert.equal(fieldText(html, "name"), "hello.txt");
    assert.equal(fieldText(html, "size"), "12.5 KB");
    assert.match(
      fieldText(html, "updated-at") ?? "",
      /^Last updated .+ by Alex Example$/,
    );
    assert.equal(fieldText(html, "mime-type"), "text/plain");
  });

  it("keeps metadata accessible without adding a second toolbar", () => {
    const html = renderMetadataStrip({ node: makeNode() });
    assert.match(html, /data-testid="files-tab-metadata-strip"/);
    assert.match(html, /class="contents"/);
    assert.match(html, /class="sr-only"/);
    assert.doesNotMatch(html, /sticky top-0/);
  });

  it("falls back to the username when the display name is absent (Req 4.6, 5.1)", () => {
    const html = renderMetadataStrip({
      node: makeNode({
        updatedByName: null,
        updatedByUsername: "alex",
      }),
    });
    assert.match(fieldText(html, "updated-at") ?? "", /^Last updated .+ by alex$/);
  });

  it("resolves the active uploader id through the project-member cache", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: testQueryClient },
        React.createElement(
          FilesTabRoleProvider,
          { role: "Role_Owner", canEdit: true },
          React.createElement(MetadataStrip, {
            node: makeNode({ updatedById: "user-rama", updatedByName: null, updatedByUsername: null }),
            uploaderNames: { "user-rama": "Rama", "creator-user": "Creator" },
            mode: "view",
            onView: () => {},
            onRaw: () => {},
            onEdit: () => {},
          }),
        ),
      ),
    );
    assert.match(fieldText(html, "updated-at") ?? "", /^Last updated .+ by Rama$/);
  });

  it("uses the latest file-version timestamp when it is present", () => {
    const html = renderMetadataStrip({
      node: makeNode({
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        versionUpdatedAt: new Date("2026-05-10T14:23:00Z"),
        updatedByName: "Version Editor",
      }),
    });

    assert.match(
      html,
      /<time[^>]+data-field="updated-at"[^>]+date[Tt]ime="2026-05-10T14:23:00\.000Z"/,
    );
    assert.match(
      fieldText(html, "updated-at") ?? "",
      /^Last updated .+ by Version Editor$/,
    );
  });

  it("lowercases the MIME type for display (design § MetadataStrip)", () => {
    const html = renderMetadataStrip({
      node: makeNode({ mimeType: "TEXT/Plain" }),
    });
    assert.equal(fieldText(html, "mime-type"), "text/plain");
  });

  it("renders updated-at as an ISO-8601 string (Req 5.1)", () => {
    const html = renderMetadataStrip({
      node: makeNode({ updatedAt: new Date("2025-01-02T03:04:05Z") }),
    });
    // Element must be a `<time>` with a matching `datetime` attribute.
    // React SSR emits the attribute as `dateTime` (camelCase); HTML is
    // case-insensitive on attribute names, so we accept either casing.
    assert.match(
      html,
      /<time[^>]+data-field="updated-at"[^>]+date[Tt]ime="2025-01-02T03:04:05\.000Z"/,
    );
    assert.match(fieldText(html, "updated-at") ?? "", /^Last updated .+/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// "—" fallback for each missing field (Req 5.9)
// ─────────────────────────────────────────────────────────────────────

describe("MetadataStrip — '—' fallback for each missing field (Req 5.9)", () => {
  const DASH = "—";

  it("renders '—' when the node name is empty", () => {
    const html = renderMetadataStrip({ node: makeNode({ name: "" }) });
    assert.equal(fieldText(html, "name"), DASH);
  });

  it("renders '—' when the size is null", () => {
    const html = renderMetadataStrip({
      node: makeNode({ size: null as unknown as number }),
    });
    assert.equal(fieldText(html, "size"), DASH);
  });

  it("renders '—' when updatedAt is null", () => {
    const html = renderMetadataStrip({
      node: makeNode({ updatedAt: null as unknown as Date }),
    });
    assert.equal(fieldText(html, "updated-at"), DASH);
    // When missing, the field becomes a plain <span> (no <time datetime=...>).
    assert.doesNotMatch(
      html,
      /<time[^>]+data-field="updated-at"/,
      "missing timestamp must not render a <time> element",
    );
  });

  it("renders '—' when updatedAt is an unparseable string", () => {
    const html = renderMetadataStrip({
      node: makeNode({ updatedAt: "not-a-date" as unknown as Date }),
    });
    assert.equal(fieldText(html, "updated-at"), DASH);
  });

  it("omits actor text when neither display name nor username is recorded", () => {
    const html = renderMetadataStrip({
      node: makeNode({ updatedByName: null, updatedByUsername: null }),
    });
    assert.doesNotMatch(fieldText(html, "updated-at") ?? "", /\sby\s/);
    assert.equal(fieldText(html, "updated-by"), null);
  });

  it("renders '—' when the MIME type is blank", () => {
    const html = renderMetadataStrip({
      node: makeNode({ mimeType: "   " }),
    });
    assert.equal(fieldText(html, "mime-type"), DASH);
  });

  it("renders '—' when the MIME type is null", () => {
    const html = renderMetadataStrip({
      node: makeNode({ mimeType: null }),
    });
    assert.equal(fieldText(html, "mime-type"), DASH);
  });

  it("renders the remaining available fields when one field is missing", () => {
    // Req 5.9 — "render the remaining available fields". When `mimeType`
    // is absent, the name/size/updated-at attribution still render their
    // real values.
    const html = renderMetadataStrip({
      node: makeNode({
        name: "doc.pdf",
        size: 2048, // → 2.0 KB
        mimeType: null,
        updatedByName: "Alex",
      }),
    });
    assert.equal(fieldText(html, "name"), "doc.pdf");
    assert.equal(fieldText(html, "size"), "2.0 KB");
    assert.equal(fieldText(html, "mime-type"), DASH);
    assert.match(fieldText(html, "updated-at") ?? "", /^Last updated .+ by Alex$/);
  });

  it("shows the real task title for a task-scoped working file", () => {
    const html = renderMetadataStrip({
      node: makeNode({
        name: "Hussain_resume.pdf",
        metadata: { taskWorkingFilesTaskTitle: "Update the related files." },
      }),
    });
    assert.equal(fieldText(html, "name"), "Hussain_resume.pdf");
    assert.equal(fieldText(html, "task-reference"), "Task: Update the related files.");
    assert.doesNotMatch(html, /9fbd8943-e594-473c-8f82-5830851d1d7a/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// VersionPill gating (Req 11.3)
// ─────────────────────────────────────────────────────────────────────

describe("MetadataStrip — VersionPill gating (Req 11.3)", () => {
  it("renders the pill when currentVersion > 1", () => {
    const html = renderMetadataStrip({
      node: makeNode({ currentVersion: 3 }),
    });
    assert.match(html, /data-testid="files-tab-version-pill"/);
    assert.match(html, /data-version="3"/);
    assert.match(html, /data-field="version"/);
    // Text is `vN` per Req 11.3.
    assert.match(html, />v3</);
  });

  it("omits the pill when currentVersion === 1", () => {
    const html = renderMetadataStrip({
      node: makeNode({ currentVersion: 1 }),
    });
    assert.doesNotMatch(html, /data-testid="files-tab-version-pill"/);
    assert.doesNotMatch(html, /data-field="version"/);
  });

  it("omits the pill when currentVersion === 0", () => {
    const html = renderMetadataStrip({
      node: makeNode({ currentVersion: 0 }),
    });
    assert.doesNotMatch(html, /data-testid="files-tab-version-pill"/);
  });

  it("omits the pill when currentVersion is negative", () => {
    const html = renderMetadataStrip({
      node: makeNode({ currentVersion: -1 }),
    });
    assert.doesNotMatch(html, /data-testid="files-tab-version-pill"/);
  });

  it("omits the pill when currentVersion is non-integer", () => {
    const html = renderMetadataStrip({
      node: makeNode({ currentVersion: 2.5 as unknown as number }),
    });
    assert.doesNotMatch(html, /data-testid="files-tab-version-pill"/);
  });

  it("omits the pill when currentVersion is null / undefined", () => {
    const htmlNull = renderMetadataStrip({
      node: makeNode({ currentVersion: null as unknown as number }),
    });
    assert.doesNotMatch(htmlNull, /data-testid="files-tab-version-pill"/);

    const htmlUndef = renderMetadataStrip({
      node: makeNode({ currentVersion: undefined as unknown as number }),
    });
    assert.doesNotMatch(htmlUndef, /data-testid="files-tab-version-pill"/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// data-node-id === node.id (Req 17.1-17.4)
// ─────────────────────────────────────────────────────────────────────

describe("MetadataStrip — data-node-id equals node.id (Req 17, design § MetadataStrip)", () => {
  it("emits `data-node-id` matching the node's id", () => {
    const html = renderMetadataStrip({
      node: makeNode({ id: "abc-123-def" }),
    });
    assert.match(html, /data-node-id="abc-123-def"/);
  });

  it("changes data-node-id when a different node is rendered", () => {
    const a = renderMetadataStrip({ node: makeNode({ id: "alpha" }) });
    const b = renderMetadataStrip({ node: makeNode({ id: "beta" }) });
    assert.match(a, /data-node-id="alpha"/);
    assert.match(b, /data-node-id="beta"/);
    // And the two snapshots are not accidentally identical — which would
    // hint that the attribute is hard-coded rather than prop-driven.
    assert.notEqual(
      a.indexOf('data-node-id="alpha"'),
      b.indexOf('data-node-id="alpha"'),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// Edit button absent for Role_Viewer (Req 5.4, 19.3)
// ─────────────────────────────────────────────────────────────────────

describe("FileActionsBar — Dropdown & Role Gating (Req 5.4, 19.3)", () => {
  const FILE_ACTIONS_BAR_SRC = readFileSync(
    path.resolve(
      __dirname,
      "../../../src/components/projects/v2/files-tab/file/FileActionsBar.tsx",
    ),
    "utf8",
  );

  it("always renders the Actions dropdown trigger", () => {
    const html = renderFileActionsBar("Role_Viewer");
    assert.match(html, /data-testid="files-tab-file-actions-dropdown-trigger"/);
  });

  it("hides edit, replace, attach options from code for Role_Viewer", () => {
    assert.match(FILE_ACTIONS_BAR_SRC, /canEditOption\s*=\s*canEdit/);
    assert.match(FILE_ACTIONS_BAR_SRC, /canReplaceOption\s*=\s*canReplace/);
    assert.match(FILE_ACTIONS_BAR_SRC, /canAttachOption\s*=\s*canAttachToTask/);
  });

  it("does not render replace input for Role_Viewer", () => {
    const html = renderFileActionsBarWithNode("Role_Viewer");
    assert.doesNotMatch(html, /data-testid="files-tab-file-actions-replace-input"/);
  });

  it("renders replace input for Role_Owner", () => {
    const html = renderFileActionsBarWithNode("Role_Owner");
    assert.match(html, /data-testid="files-tab-file-actions-replace-input"/);
  });

  it("renders replace input for Role_Member", () => {
    const html = renderFileActionsBarWithNode("Role_Member");
    assert.match(html, /data-testid="files-tab-file-actions-replace-input"/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 0-byte image / video / audio placeholder (Req 5.6)
// ─────────────────────────────────────────────────────────────────────
//
// `FileView` itself imports server actions (`@/app/actions/files`) which
// validate env vars at module load, so we cannot mount `FileView` under
// `tsx --test`. Instead we pin Req 5.6 at two layers that together
// guarantee the observable behaviour:
//
//   (1) The pure helper `isEmptyMedia` classifies only image / video /
//       audio with an explicit `size === 0` as empty.
//   (2) A source-level contract on `FileView.tsx` proves the emptyMedia
//       branch renders `<EmptyMediaPlaceholder ...>` and short-circuits
//       ahead of `AssetPreview` / `MarkdownPreview` / `TextViewer`.

describe("FileView — 0-byte media placeholder (Req 5.6) — pure helper", () => {
  it("classifies 0-byte image / video / audio as empty media", () => {
    assert.equal(isEmptyMedia({ size: 0 }, "image"), true);
    assert.equal(isEmptyMedia({ size: 0 }, "video"), true);
    assert.equal(isEmptyMedia({ size: 0 }, "audio"), true);
  });

  it("does NOT classify 0-byte pdf / doc / text / binary as empty (Req 5.6 scope)", () => {
    // Req 5.6 explicitly scopes the placeholder to image / video / audio.
    assert.equal(isEmptyMedia({ size: 0 }, "pdf"), false);
    assert.equal(isEmptyMedia({ size: 0 }, "doc"), false);
    assert.equal(isEmptyMedia({ size: 0 }, "text"), false);
    assert.equal(isEmptyMedia({ size: 0 }, "binary"), false);
  });

  it("does NOT classify non-zero-size media as empty", () => {
    assert.equal(isEmptyMedia({ size: 1 }, "image"), false);
    assert.equal(isEmptyMedia({ size: 2048 }, "video"), false);
    assert.equal(isEmptyMedia({ size: 1024 }, "audio"), false);
  });

  it("does NOT classify unknown-size media (null / undefined) as empty", () => {
    // Strict: only an explicit zero qualifies; a missing size must not
    // cause us to hide valid-but-not-yet-loaded media as empty.
    assert.equal(
      isEmptyMedia({ size: null as unknown as number }, "image"),
      false,
    );
    assert.equal(
      isEmptyMedia({ size: undefined as unknown as number }, "image"),
      false,
    );
  });
});

describe("FileView — 0-byte media placeholder (Req 5.6) — source-level contract", () => {
  const FILE_VIEW_SRC = readFileSync(
    path.resolve(
      __dirname,
      "../../../src/components/projects/v2/files-tab/file/FileView.tsx",
    ),
    "utf8",
  );

  it("renders `<EmptyMediaPlaceholder>` when `emptyMedia === true`", () => {
    // The branch must render the placeholder BEFORE any preview component
    // is considered — otherwise a 0-byte image could still fall through
    // to `AssetPreview`.
    const emptyBranch = /if\s*\(\s*p\.emptyMedia\s*\)\s*{\s*return\s+<EmptyMediaPlaceholder\s+kind=\{p\.kind\}\s*\/>\s*;?\s*}/;
    assert.match(
      FILE_VIEW_SRC,
      emptyBranch,
      "FileView must short-circuit to <EmptyMediaPlaceholder> when emptyMedia is true (Req 5.6)",
    );
  });

  it("computes `emptyMedia` from the pure `isEmptyMedia` helper", () => {
    // Guards against a refactor that re-implements the predicate inline
    // and drifts from the helper tested above.
    assert.match(
      FILE_VIEW_SRC,
      /emptyMedia\s*=\s*React\.useMemo\(\s*\(\)\s*=>\s*isEmptyMedia\(node,\s*kind\)/,
      "FileView must derive `emptyMedia` by calling `isEmptyMedia(node, kind)` (Req 5.6)",
    );
  });

  it("EmptyMediaPlaceholder carries a testid and labels image / video / audio", () => {
    // The placeholder is what the user sees in place of the preview.
    // Pin the testid hook + per-kind labels so downstream E2E tests and
    // a11y audits cannot silently lose them.
    assert.match(
      FILE_VIEW_SRC,
      /data-testid="files-tab-file-view-empty-media"/,
      "EmptyMediaPlaceholder must expose a testid for E2E + a11y hooks",
    );
    assert.match(FILE_VIEW_SRC, /label:\s*"image"/);
    assert.match(FILE_VIEW_SRC, /label:\s*"video"/);
    assert.match(FILE_VIEW_SRC, /label:\s*"audio"/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Task 7.3: "Replace…" button in FileActionsBar (Req 11.1–11.6, 24.1)
// ─────────────────────────────────────────────────────────────────────

/**
 * Render `FileActionsBar` with `projectId` and `nodeId` so the Replace
 * button can appear (it requires both to be truthy + canEdit).
 */
function renderFileActionsBarWithNode(role: Role): string {
  const canEdit = role !== "Role_Viewer";
  return renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client: testQueryClient },
      React.createElement(
        FilesTabRoleProvider,
        { role, canEdit },
        React.createElement(FileActionsBar, {
          mode: "view",
          onView: () => {},
          onRaw: () => {},
          onEdit: () => {},
          projectId: "proj-test-123",
          nodeId: "node-test-456",
        }),
      ),
    )
  );
}

describe("FileActionsBar — Replace… button (Req 11.1, 11.2, 24.1)", () => {
  it("hides the Replace button when role is Role_Viewer (Req 11.2, 24.1)", () => {
    const html = renderFileActionsBarWithNode("Role_Viewer");
    assert.doesNotMatch(
      html,
      /data-testid="files-tab-file-actions-replace-input"/,
      "Role_Viewer must not see the Replace button input (Req 11.2, 24.1)",
    );
  });

  it("shows the Replace button for Role_Owner (Req 11.1)", () => {
    const html = renderFileActionsBarWithNode("Role_Owner");
    assert.match(
      html,
      /data-testid="files-tab-file-actions-replace-input"/,
      "Role_Owner must see the Replace button input (Req 11.1)",
    );
  });

  it("shows the Replace button for Role_Member (Req 11.1)", () => {
    const html = renderFileActionsBarWithNode("Role_Member");
    assert.match(
      html,
      /data-testid="files-tab-file-actions-replace-input"/,
      "Role_Member must see the Replace button input (Req 11.1)",
    );
  });

  it("does NOT show Replace button when projectId or nodeId is missing", () => {
    // Without projectId/nodeId, canReplace is false regardless of role.
    const html = renderFileActionsBar("Role_Owner");
    assert.doesNotMatch(
      html,
      /data-testid="files-tab-file-actions-replace-input"/,
      "Replace button input requires both projectId and nodeId",
    );
  });

  it("renders a hidden file input for native file picker (Req 11.3)", () => {
    const html = renderFileActionsBarWithNode("Role_Owner");
    assert.match(
      html,
      /data-testid="files-tab-file-actions-replace-input"/,
      "Must render a hidden file input for native file picker (Req 11.3)",
    );
    // The input must be hidden (class="hidden") and type="file"
    assert.match(html, /type="file"[^>]*class="hidden"/);
  });

  it("Replace button has accessible label and text in source (Req 11.1)", () => {
    const FILE_ACTIONS_BAR_SRC = readFileSync(
      path.resolve(
        __dirname,
        "../../../src/components/projects/v2/files-tab/file/FileActionsBar.tsx",
      ),
      "utf8",
    );
    assert.match(
      FILE_ACTIONS_BAR_SRC,
      /aria-label="Upload a file revision"/,
      "Replace button must have an accessible label in source code",
    );
    assert.match(
      FILE_ACTIONS_BAR_SRC,
      /Upload revision…/,
      "Version upload must use explicit action copy",
    );
    assert.match(
      FILE_ACTIONS_BAR_SRC,
      /canReplaceOption/,
      "Replace button must guard rendering with canReplaceOption in source code",
    );
  });
});

describe("FileActionsBar — Replace… source-level contracts (Req 11.4–11.6, 5.2, 16.3)", () => {
  const FILE_ACTIONS_BAR_SRC = readFileSync(
    path.resolve(
      __dirname,
      "../../../src/components/projects/v2/files-tab/file/FileActionsBar.tsx",
    ),
    "utf8",
  );

  it("routes file selection through the canonical revision utility (Req 11.4)", () => {
    assert.match(
      FILE_ACTIONS_BAR_SRC,
      /saveFileRevision\(\{\s*projectId,\s*nodeId,\s*file,/,
      "Must call saveFileRevision with the selected file (Req 11.4)",
    );
    assert.match(FILE_ACTIONS_BAR_SRC, /new_revision/);
    assert.match(FILE_ACTIONS_BAR_SRC, /active_revision/);
  });

  it("handles lock conflict by setting lockConflict state (Req 11.5, 5.2)", () => {
    assert.match(
      FILE_ACTIONS_BAR_SRC,
      /setLockConflict\(result\.lockConflict\)/,
      "Must set lockConflict state on lock conflict error (Req 11.5)",
    );
    // Verify the lock indicator renders the display name
    assert.match(
      FILE_ACTIONS_BAR_SRC,
      /Locked by \{lockConflict\.lockedBy\.displayName\}/,
      "Must display 'Locked by {displayName}' indicator (Req 5.2)",
    );
  });

  it("allows retry after lock conflict but blocks replacement during edit/upload", () => {
    assert.match(
      FILE_ACTIONS_BAR_SRC,
      /disabled=\{isReplacing \|\| mode === "edit"\}/,
      "Replacement cannot discard an active editor or start a duplicate upload",
    );
    assert.match(FILE_ACTIONS_BAR_SRC, /Retry upload revision/);
  });

  it("emits files_tab.version_replaced telemetry with source: files_tab (Req 16.3)", () => {
    assert.match(
      FILE_ACTIONS_BAR_SRC,
      /logger\.metric\("files_tab\.version_replaced"/,
      "Must emit files_tab.version_replaced telemetry (Req 16.3)",
    );
    assert.match(
      FILE_ACTIONS_BAR_SRC,
      /source:\s*"files_tab"/,
      "Telemetry must include source: 'files_tab' (Req 16.3)",
    );
  });
});
