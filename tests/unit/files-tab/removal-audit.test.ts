// Task 10.1 — Removal Plan Audit test.
//
// This test is a *best-effort* audit that catalogs every remaining reference
// to modules and store-slice methods that are scheduled for deletion in
// Task 13 (see design § Removal Plan + § Audit Note, and the "Removal Plan
// Audit" section of `.kiro/specs/files-tab-github-redesign/tasks.md`).
//
// For each to-be-deleted module path + every dropped store method name, the
// test shells out to ripgrep (`rg`) via `child_process.execFileSync` to find
// every textual reference across the repo, then classifies each hit into:
//
//   - `allowed-self`   — the reference lives inside a file that is itself
//                        scheduled for deletion in Task 13. Going away
//                        together is fine.
//   - `allowed-legacy` — the reference lives under
//                        `src/components/projects/v2/workspace/` (the old
//                        `WorkspaceShell` branch). That subtree still runs
//                        when `filesTabV3Enabled` is off, so references are
//                        expected to remain until Task 13.4 runs.
//   - `allowed-spec`   — the reference is inside the spec markdown, a test
//                        file, a script under `scripts/`, or itself (this
//                        test). Informational; excluded from the "unexpected"
//                        bucket.
//   - `likely-collision` — a store-method name matched in a file that does
//                        NOT import `@/stores/filesWorkspaceStore` — almost
//                        certainly an unrelated local identifier (e.g. a
//                        React `useState` setter called `setActiveTab`).
//                        Demoted so reviewers can ignore noise.
//   - `unexpected`     — everything else. Logged to the report for Task 13
//                        to review, but does NOT fail the build today
//                        because the legacy path is still live behind the
//                        feature flag.
//
// The test writes a JSON report to `artifacts/files-tab-removal-audit.json`
// which Task 13.4 / 13.5 consume as the pre-delete gate. The assertions
// below intentionally verify only that the report is well-formed; they do
// not fail on unexpected references because the coexistence period (Req
// 21.7–21.8) requires legacy references to remain until the flag ramps to
// 100%.
//
// If ripgrep is not installed locally, the test falls back to `git grep`
// (every contributor has git). If both are missing, the test records
// `searchTool: "none"` in the report and skips the per-target searches
// rather than failing outright — this keeps CI green on minimal images
// while still alerting reviewers via the report.
//
// Validates: Req 15.1–15.19, Req 21.7–21.8; design § Removal Plan + § Audit
// Note.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Repo-relative paths
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const ARTIFACTS_DIR = path.join(REPO_ROOT, "artifacts");
const REPORT_PATH = path.join(ARTIFACTS_DIR, "files-tab-removal-audit.json");

// Legacy subtree: references here are expected and allowed until Task 13.4.
const LEGACY_PREFIX = "src/components/projects/v2/workspace/";

const LEGACY_SATELLITES = new Set<string>();

// Files that declare or re-export the store slice APIs themselves. A hit
// inside one of these is just the slice declaring / barrel-exporting its own
// method — it disappears when the slice method is dropped in Task 13.5.
const STORE_DECLARATION_FILES = new Set<string>([
  "src/stores/files/types.ts",
  "src/stores/files/index.ts",
  "src/stores/files/workspaceSlice.ts",
  "src/stores/files/explorerSlice.ts",
  "src/stores/files/editorSlice.ts",
  "src/stores/files/gitSlice.ts",
  "src/stores/files/selectors.ts",
  "src/stores/filesWorkspaceStore.ts",
]);

// Paths that should be ignored when classifying references (spec docs,
// tests, scripts, this very file, lockfiles, etc.).
const INFORMATIONAL_PREFIXES = [
  ".kiro/",
  "tests/",
  "scripts/",
  "docs/",
  ".next/",
  "node_modules/",
  "artifacts/",
];

// ---------------------------------------------------------------------------
// Targets — the single source of truth for the audit.
// Mirrors the "Removal Plan Audit" section of tasks.md which mirrors
// design § Removal Plan.
// ---------------------------------------------------------------------------

interface FileTarget {
  kind: "file-module";
  /** Repo-relative source path (without leading `./`). */
  path: string;
  /** The `@/...` alias a consumer would write in `from "..."`. */
  alias: string;
}

interface MethodTarget {
  kind: "store-method";
  slice: string;
  name: string;
}

interface PriorityGroup {
  id: number;
  name: string;
  requirements: string;
  targets: Array<FileTarget | MethodTarget>;
}

/** Convert `src/path/to/file.ts` → `@/path/to/file`. */
function toAlias(p: string): string {
  const withoutSrc = p.replace(/^src\//, "@/");
  return withoutSrc.replace(/\.(ts|tsx)$/, "");
}

function fileTarget(p: string): FileTarget {
  return { kind: "file-module", path: p, alias: toAlias(p) };
}

const PRIORITY_GROUPS: PriorityGroup[] = [
  {
    id: 5,
    name: "Store Slice Methods",
    requirements: "Req 15.7, 15.11, 15.14, 15.18",
    targets: [
      // workspaceSlice — tabs + split
      { kind: "store-method", slice: "workspaceSlice", name: "setSplitEnabled" },
      { kind: "store-method", slice: "workspaceSlice", name: "setSplitRatio" },
      { kind: "store-method", slice: "workspaceSlice", name: "pinTab" },
      { kind: "store-method", slice: "workspaceSlice", name: "closeOtherTabs" },
      { kind: "store-method", slice: "workspaceSlice", name: "closeTabsToRight" },
      { kind: "store-method", slice: "workspaceSlice", name: "openTab" },
      { kind: "store-method", slice: "workspaceSlice", name: "closeTab" },
      { kind: "store-method", slice: "workspaceSlice", name: "setActiveTab" },
      { kind: "store-method", slice: "workspaceSlice", name: "reorderTabs" },
      { kind: "store-method", slice: "workspaceSlice", name: "moveTabToPane" },
      { kind: "store-method", slice: "workspaceSlice", name: "pruneGhostTabs" },

      // workspaceSlice — bottom panel + search/replace + command palette
      { kind: "store-method", slice: "workspaceSlice", name: "toggleBottomPanel" },
      { kind: "store-method", slice: "workspaceSlice", name: "setBottomPanelTab" },
      { kind: "store-method", slice: "workspaceSlice", name: "setBottomPanelHeight" },
      { kind: "store-method", slice: "workspaceSlice", name: "setLastExecutionOutput" },
      { kind: "store-method", slice: "workspaceSlice", name: "setLastExecutionSettingsHref" },
      { kind: "store-method", slice: "workspaceSlice", name: "setStdinInputText" },
      { kind: "store-method", slice: "workspaceSlice", name: "setProblems" },
      { kind: "store-method", slice: "workspaceSlice", name: "clearProblems" },
      { kind: "store-method", slice: "workspaceSlice", name: "applyQuickFix" },
      { kind: "store-method", slice: "workspaceSlice", name: "pushCommandToHistory" },
      { kind: "store-method", slice: "workspaceSlice", name: "setSidebarWidth" },
      { kind: "store-method", slice: "workspaceSlice", name: "toggleZenMode" },
      { kind: "store-method", slice: "workspaceSlice", name: "setSearchReplaceOpen" },
      { kind: "store-method", slice: "workspaceSlice", name: "setCommandPaletteOpen" },
      { kind: "store-method", slice: "workspaceSlice", name: "setOutputFilterMode" },

      // explorerSlice — saved views
      { kind: "store-method", slice: "explorerSlice", name: "saveCurrentView" },
      { kind: "store-method", slice: "explorerSlice", name: "applySavedView" },
      { kind: "store-method", slice: "explorerSlice", name: "deleteSavedView" },

      // editorSlice — per-file UI state
      { kind: "store-method", slice: "editorSlice", name: "setFileState" },
      { kind: "store-method", slice: "editorSlice", name: "setActiveFileSymbols" },
      { kind: "store-method", slice: "editorSlice", name: "requestScrollTo" },
      { kind: "store-method", slice: "editorSlice", name: "clearScrollRequest" },

      // editorSlice — locks/events live with editor state
      { kind: "store-method", slice: "editorSlice", name: "setLock" },
      { kind: "store-method", slice: "editorSlice", name: "clearLock" },

      // gitSlice — sync/commit/branches/lastSync/clearState
      { kind: "store-method", slice: "gitSlice", name: "setGitSyncStatus" },
      { kind: "store-method", slice: "gitSlice", name: "setGitCommitMessage" },
      { kind: "store-method", slice: "gitSlice", name: "setGitBranches" },
      { kind: "store-method", slice: "gitSlice", name: "setGitLastSync" },
      { kind: "store-method", slice: "gitSlice", name: "clearGitState" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Search tool abstraction
// ---------------------------------------------------------------------------

type SearchTool = "rg" | "git-grep" | "none";

interface RawHit {
  file: string; // repo-relative
  line: number;
  text: string;
}

function runRipgrep(pattern: string, wordBoundary: boolean): RawHit[] {
  // ripgrep: -n line numbers, --no-heading, --color=never.
  // We use `-w` (word-boundary) for store-method names so an unrelated
  // `setActiveTab` React useState setter in a different component doesn't
  // collide — and regex mode + `-F` are mutually exclusive, so fall back to
  // fixed-string for file paths that contain `/` and `.` literals.
  const args = [
    "-n",
    "--no-heading",
    "--color=never",
    ...(wordBoundary ? ["-w"] : ["-F"]),
    "--hidden",
    "-g",
    "!node_modules",
    "-g",
    "!.next",
    "-g",
    "!artifacts",
    "--",
    pattern,
    ".",
  ];
  try {
    const stdout = execFileSync("rg", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    return parseGrepOutput(stdout);
  } catch (error) {
    if (typeof error === "object" && error && "status" in error && (error as { status?: number }).status === 1) {
      return [];
    }
    throw error;
  }
}

function runGitGrep(pattern: string, wordBoundary: boolean): RawHit[] {
  // `git grep -n` — add `-w` when we want word-boundary matching on
  // identifier-style queries, otherwise fall back to `--fixed-strings` for
  // path-shaped queries containing `/` and `.`.
  //
  // Crucial: we append `:(exclude)artifacts`, `:(exclude)node_modules`, and
  // `:(exclude).next` to prevent recursive matches in the generated audit report
  // and untracked build artifacts, which otherwise cause buffer overflows (ENOBUFS).
  try {
    const exclusions = [
      ":(exclude)artifacts",
      ":(exclude)node_modules",
      ":(exclude).next",
    ];
    const args = wordBoundary
      ? ["grep", "-n", "-w", "--", pattern, ...exclusions]
      : ["grep", "-n", "--fixed-strings", "--", pattern, ...exclusions];
    const stdout = execFileSync("git", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    return parseGrepOutput(stdout);
  } catch (err) {
    const status = (err as { status?: number } | undefined)?.status;
    if (status === 1) return []; // "no matches" — not an error.
    throw err;
  }
}

function parseGrepOutput(stdout: string): RawHit[] {
  const hits: RawHit[] = [];
  for (const raw of stdout.split("\n")) {
    if (!raw) continue;
    // Format: path:line:text  (path may start with `./` on rg output)
    const firstColon = raw.indexOf(":");
    if (firstColon === -1) continue;
    const secondColon = raw.indexOf(":", firstColon + 1);
    if (secondColon === -1) continue;
    let file = raw.slice(0, firstColon);
    const lineStr = raw.slice(firstColon + 1, secondColon);
    const text = raw.slice(secondColon + 1);
    const line = Number.parseInt(lineStr, 10);
    if (!Number.isFinite(line)) continue;
    if (file.startsWith("./")) file = file.slice(2);
    hits.push({ file, line, text });
  }
  return hits;
}

function detectSearchTool(): SearchTool {
  // Probe `rg --version`; fall back to `git --version`; else "none".
  try {
    execFileSync("rg", ["--version"], { stdio: "ignore" });
    return "rg";
  } catch {
    /* ignore */
  }
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return "git-grep";
  } catch {
    /* ignore */
  }
  return "none";
}

function search(pattern: string, tool: SearchTool, wordBoundary: boolean): RawHit[] {
  if (tool === "rg") return runRipgrep(pattern, wordBoundary);
  if (tool === "git-grep") return runGitGrep(pattern, wordBoundary);
  return [];
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

type Classification =
  | "allowed-self"
  | "allowed-legacy"
  | "allowed-spec"
  | "likely-collision"
  | "unexpected";

interface ClassifiedHit extends RawHit {
  classification: Classification;
}

interface TargetReport {
  kind: "file-module" | "store-method";
  label: string;
  searchQuery: string;
  path?: string;
  slice?: string;
  references: ClassifiedHit[];
  counts: Record<Classification, number>;
}

/** The set of repo-relative file paths that are themselves scheduled for
 *  deletion (priorities 1–4). Reference inside one of these = allowed-self. */
const SELF_DELETION_FILES: Set<string> = new Set(
  PRIORITY_GROUPS.flatMap((g) =>
    g.targets
      .filter((t): t is FileTarget => t.kind === "file-module")
      .map((t) => t.path),
  ),
);

function classifyFileRef(hit: RawHit, selfPath: string | null): Classification {
  // Normalize path separator in case rg/git emits platform-specific slashes.
  const file = hit.file.replace(/\\/g, "/");

  // The file is itself scheduled for deletion.
  if (selfPath && file === selfPath) return "allowed-self";
  if (SELF_DELETION_FILES.has(file)) return "allowed-self";

  // Anything under the legacy WorkspaceShell subtree is allowed during
  // coexistence (Req 21.7–21.8). Priority 3 already covers most of those
  // files individually, but this catches any new co-located helper too.
  if (file.startsWith(LEGACY_PREFIX)) return "allowed-legacy";
  if (LEGACY_SATELLITES.has(file)) return "allowed-legacy";

  // Spec / test / script / generated hits: informational.
  if (INFORMATIONAL_PREFIXES.some((p) => file.startsWith(p))) {
    return "allowed-spec";
  }

  return "unexpected";
}

function classifyMethodRef(hit: RawHit, sliceFile: string | null): Classification {
  const file = hit.file.replace(/\\/g, "/");

  // The slice's own declaration / the store barrel file / the slice
  // co-located helpers — all go away together.
  if (sliceFile && file === sliceFile) return "allowed-self";
  if (STORE_DECLARATION_FILES.has(file)) return "allowed-self";

  // Priority-1..4 modules that are being deleted anyway.
  if (SELF_DELETION_FILES.has(file)) return "allowed-self";

  // Legacy WorkspaceShell subtree + satellites.
  if (file.startsWith(LEGACY_PREFIX)) return "allowed-legacy";
  if (LEGACY_SATELLITES.has(file)) return "allowed-legacy";

  // Informational surfaces.
  if (INFORMATIONAL_PREFIXES.some((p) => file.startsWith(p))) {
    return "allowed-spec";
  }

  // Method-name collisions: if the host file doesn't even import the
  // files-workspace store, the hit is an unrelated local identifier (e.g.
  // a React `useState` setter called `setActiveTab`). Demote to
  // `likely-collision` so reviewers can filter these out of the report.
  if (!fileImportsWorkspaceStore(file)) return "likely-collision";

  return "unexpected";
}

function emptyCounts(): Record<Classification, number> {
  return {
    "allowed-self": 0,
    "allowed-legacy": 0,
    "allowed-spec": 0,
    "likely-collision": 0,
    unexpected: 0,
  };
}

/**
 * Cache of whether a given source file imports the files workspace store.
 * Store-method hits only count as `unexpected` when the host file also
 * imports `@/stores/filesWorkspaceStore` or a `@/stores/files/` slice —
 * otherwise the hit is a local identifier collision (e.g. an unrelated
 * `const [activeTab, setActiveTab] = useState(...)` somewhere else in the
 * product) and is classified `likely-collision` instead.
 */
const storeImportCache = new Map<string, boolean>();

function fileImportsWorkspaceStore(relFile: string): boolean {
  const cached = storeImportCache.get(relFile);
  if (cached !== undefined) return cached;
  let imports = false;
  try {
    const abs = path.join(REPO_ROOT, relFile);
    // Read only once per file; cap size to keep the test fast.
    const contents = readFileSync(abs, "utf8");
    imports =
      contents.includes("@/stores/filesWorkspaceStore") ||
      contents.includes("@/stores/files/");
  } catch {
    imports = false;
  }
  storeImportCache.set(relFile, imports);
  return imports;
}

// ---------------------------------------------------------------------------
// Per-target audit
// ---------------------------------------------------------------------------

function auditFileTarget(target: FileTarget, tool: SearchTool): TargetReport {
  // Search the `@/...` alias. Consumers almost
  // always import via the alias; bare relative imports land in sibling files
  // which are themselves priority-3 deletions and therefore allowed-self.
  // Path-shaped queries use fixed-string matching (no word boundary).
  const hits = search(target.alias, tool, false);
  const references: ClassifiedHit[] = hits.map((h) => ({
    ...h,
    classification: classifyFileRef(h, target.path),
  }));
  const counts = emptyCounts();
  for (const ref of references) counts[ref.classification] += 1;
  return {
    kind: "file-module",
    label: target.path,
    searchQuery: target.alias,
    path: target.path,
    references,
    counts,
  };
}

/**
 * Build a set of slice file paths so we can treat the slice's own
 * declaration line as `allowed-self` (otherwise every slice method would
 * count its own `export function setSplitEnabled(...)` as "unexpected").
 */
const SLICE_PATHS: Record<string, string> = {
  workspaceSlice: "src/stores/files/workspaceSlice.ts",
  explorerSlice: "src/stores/files/explorerSlice.ts",
  editorSlice: "src/stores/files/editorSlice.ts",
  gitSlice: "src/stores/files/gitSlice.ts",
};

function auditMethodTarget(target: MethodTarget, tool: SearchTool): TargetReport {
  // Method names are identifiers — use word-boundary matching so
  // `setActiveTab` doesn't match `setActiveTabKey`. Common names like
  // `setActiveTab` still hit unrelated local React `useState` setters; those
  // land in files outside the store/legacy/deletion surfaces and are
  // filtered to `unexpected`. Consumers reviewing the report can eyeball
  // those to confirm they're identifier collisions, not true references.
  const hits = search(target.name, tool, true);
  const slicePath = SLICE_PATHS[target.slice];
  const references: ClassifiedHit[] = hits.map((h) => ({
    ...h,
    classification: classifyMethodRef(h, slicePath ?? null),
  }));
  const counts = emptyCounts();
  for (const ref of references) counts[ref.classification] += 1;
  return {
    kind: "store-method",
    label: `${target.slice}.${target.name}`,
    searchQuery: target.name,
    slice: target.slice,
    references,
    counts,
  };
}

// ---------------------------------------------------------------------------
// Test entry point
// ---------------------------------------------------------------------------

test("removal-audit: catalogs references for every to-be-deleted module and store method", () => {
  const tool = detectSearchTool();

  interface GroupReport {
    id: number;
    name: string;
    requirements: string;
    targets: TargetReport[];
  }

  const priorityReports: GroupReport[] = PRIORITY_GROUPS.map((group) => ({
    id: group.id,
    name: group.name,
    requirements: group.requirements,
    targets: group.targets.map((t) =>
      t.kind === "file-module"
        ? auditFileTarget(t, tool)
        : auditMethodTarget(t, tool),
    ),
  }));

  // Aggregate summary.
  const summary = {
    searchTool: tool,
    totalTargets: priorityReports.reduce(
      (acc, g) => acc + g.targets.length,
      0,
    ),
    totalReferences: priorityReports.reduce(
      (acc, g) =>
        acc +
        g.targets.reduce((inner, t) => inner + t.references.length, 0),
      0,
    ),
    counts: priorityReports.reduce(
      (acc, g) => {
        for (const t of g.targets) {
          acc["allowed-self"] += t.counts["allowed-self"];
          acc["allowed-legacy"] += t.counts["allowed-legacy"];
          acc["allowed-spec"] += t.counts["allowed-spec"];
          acc["likely-collision"] += t.counts["likely-collision"];
          acc.unexpected += t.counts.unexpected;
        }
        return acc;
      },
      emptyCounts(),
    ),
  };

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    searchTool: tool,
    repoRoot: REPO_ROOT,
    notes: [
      "Best-effort audit: `unexpected` counts are logged for Task 13 review",
      "but do NOT fail the build while `filesTabV3Enabled` is ramping.",
      "Task 13.4 / 13.5 must re-run this audit and confirm zero `unexpected`",
      "references before any deletion lands.",
    ].join(" "),
    summary,
    priorities: priorityReports,
  };

  // Ensure artifacts/ exists, then write the JSON report.
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  // --- Assertions (well-formedness only; do not fail on "unexpected") ---

  // The search tool resolved to one of the supported values.
  assert.ok(
    tool === "rg" || tool === "git-grep" || tool === "none",
    `unexpected searchTool: ${tool}`,
  );

  // Every remaining priority group from the removal plan is represented.
  assert.deepEqual(
    priorityReports.map((g) => g.id),
    PRIORITY_GROUPS.map((g) => g.id),
    "all configured Removal Plan priorities must appear in the audit report",
  );

  // Every file in the SELF_DELETION_FILES set exists in one of the file
  // targets — guards against typos drifting between tasks.md and the test.
  for (const filePath of SELF_DELETION_FILES) {
    const hit = priorityReports.some((g) =>
      g.targets.some((t) => t.kind === "file-module" && t.path === filePath),
    );
    assert.ok(hit, `deletion target missing from report: ${filePath}`);
  }

  // Every target produced a TargetReport with a classification bucket.
  for (const group of priorityReports) {
    for (const tgt of group.targets) {
      for (const c of [
        "allowed-self",
        "allowed-legacy",
        "allowed-spec",
        "likely-collision",
        "unexpected",
      ] as const) {
        assert.ok(
          typeof tgt.counts[c] === "number" && tgt.counts[c] >= 0,
          `bad count for ${tgt.label} / ${c}`,
        );
      }
    }
  }

  // Human-readable summary on stdout so CI logs surface the unexpected
  // count without requiring reviewers to open the artifact file.
  const lines: string[] = [
    `[removal-audit] searchTool=${tool} targets=${summary.totalTargets} refs=${summary.totalReferences}`,
    `[removal-audit] allowed-self=${summary.counts["allowed-self"]} allowed-legacy=${summary.counts["allowed-legacy"]} allowed-spec=${summary.counts["allowed-spec"]} likely-collision=${summary.counts["likely-collision"]} unexpected=${summary.counts.unexpected}`,
    `[removal-audit] report written to ${path.relative(REPO_ROOT, REPORT_PATH)}`,
  ];
  for (const line of lines) console.log(line);

  // When ripgrep/git are missing, every target produced zero hits. That's
  // expected and the report records `searchTool: "none"` for Task 13 to
  // re-run in a proper CI environment — don't fail here.
  if (tool === "none") {
    console.warn(
      "[removal-audit] WARNING: neither `rg` nor `git` was available; " +
        "the report is empty. Re-run in CI where ripgrep is installed.",
    );
  }
});
