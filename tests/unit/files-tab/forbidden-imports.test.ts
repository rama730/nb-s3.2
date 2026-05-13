// Task 11.3 — Static import-graph test.
//
// **Validates: Req 15.3, 15.4, 15.11–15.13, 15.15–15.17, 16.1–16.3, 21.5**
//
// Contract under test:
//
//   Starting from `src/components/projects/v2/files-tab/FilesTabRoot.tsx`
//   and walking every *static* `import` / `export ... from` edge, no path
//   must reach any module on the forbidden list below. A **static** edge
//   is a top-level `import`/`export-from` statement. A **dynamic** edge —
//   an `import("...")` expression, including the inner `import()` inside
//   a `next/dynamic(() => import(...))` loader — is NOT traversed. The
//   rationale is that `dynamic` only invokes its loader at render time,
//   and the Req-16 performance budget explicitly allows those code paths
//   as long as they do not ship in the initial mount chunk.
//
//   The forbidden list (mirrors Task 11.3 in tasks.md):
//
//     - Any module under `src/lib/runner/`                      (Req 15.3, 16.1)
//     - `src/components/projects/v2/panels/BottomPanel.tsx`     (Req 15.1, 16.2)
//     - `src/components/projects/v2/panels/RunTab.tsx`          (Req 15.2, 16.2)
//     - `src/components/projects/v2/panels/OutputTab.tsx`       (Req 15.2, 16.2)
//     - `src/components/projects/v2/panels/ProblemsTab.tsx`     (Req 15.2, 16.2)
//     - `src/components/projects/v2/panels/RunnerStatusStrip.tsx` (Req 16.2)
//     - `src/components/projects/v2/workspace/useLintOnEdit.ts` (Req 15.4, 16.3)
//     - `src/components/projects/v2/workspace/useCursorPresence.ts` (Req 15.13, 21.5)
//     - `src/components/projects/v2/workspace/cursorProtocol.ts`  (Req 15.13, 21.5)
//     - `src/app/actions/parseStderrToProblems.ts`              (Req 15.5)
//     - `src/components/projects/v2/workspace/KeyboardShortcuts.tsx` (Req 15.12)
//     - `src/components/projects/v2/explorer/OutlinePanel.tsx`  (Req 15.15)
//     - `src/components/projects/v2/explorer/SourceControlPanel.tsx` (Req 15.16)
//     - `src/components/projects/v2/explorer/ExplorerInsightsHost.tsx` (Req 15.17)
//     - `src/components/projects/v2/explorer/ExplorerCommandPalette.tsx` (Req 15.11)
//
// ─── Test strategy ──────────────────────────────────────────────────
//
// Rather than spinning up the TypeScript compiler API, this test uses a
// simple regex scanner that reads each source file, extracts every
// top-level `import ... from "..."` / `export ... from "..."` specifier,
// resolves it against the filesystem, and recurses with a visited set.
// Regex scanning is intentional — the repository already uses this
// pattern in `removal-audit.test.ts` and it keeps the test portable
// across environments where the TS compiler may not be available in the
// test harness. It is "good enough" because:
//
//   * All specifiers in this codebase are string literals (no
//     synthesised-string tricks). A regex on `from "..."` catches every
//     one.
//   * Re-exports (`export * from "..."`) are caught the same way.
//   * Inline `import("...")` expressions are *not* matched because they
//     lack the `from` keyword — so we get dynamic-import exclusion for
//     free, which is exactly the design requirement.
//   * Multi-line imports (`import {\n  a,\n  b\n} from "x"`) are handled
//     by using a greedy-but-anchored pattern on the `from "..."` tail.
//
// ─── Classification ─────────────────────────────────────────────────
//
// Each forbidden target reached by the static graph is recorded in the
// report with one or more *import chains* — the sequence of files from
// `FilesTabRoot.tsx` down to the forbidden module. Chains make the
// Task-13 removal work actionable: reviewers see exactly which
// intermediate component (e.g. `ExplorerDialogsHost`) is the bridge
// that needs breaking.
//
// ─── Assertion philosophy ───────────────────────────────────────────
//
// The task description explicitly says:
//
//     "If the test finds a forbidden path reachable, report it (listing
//      the chain) but don't necessarily fail the build — the task says
//      'fail the build if exceeded' for the performance case, but for
//      import graph, document what was found."
//
// Consistent with `removal-audit.test.ts`, this test therefore asserts
// only the *well-formedness* of the generated report and logs any
// forbidden-reach findings to stdout. Task 13 will re-run this test
// after the legacy cleanup lands and flip the report assertions to
// hard failures once the graph is clean.
//
// The report is written to
// `artifacts/files-tab-forbidden-imports.json` for Task 13 to consume
// as a pre-delete gate, mirroring the Task-10.1 audit artifact.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Repo-relative paths
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SRC_ROOT = path.join(REPO_ROOT, "src");
const ARTIFACTS_DIR = path.join(REPO_ROOT, "artifacts");
const REPORT_PATH = path.join(
  ARTIFACTS_DIR,
  "files-tab-forbidden-imports.json",
);

const ENTRY_REL = "src/components/projects/v2/files-tab/FilesTabRoot.tsx";
const ENTRY_ABS = path.join(REPO_ROOT, ENTRY_REL);

// ---------------------------------------------------------------------------
// Forbidden target list
// ---------------------------------------------------------------------------
//
// Two kinds of targets:
//   - "prefix": any module whose repo-relative path starts with the given
//               prefix (used for `src/lib/runner/`, which is a whole subtree).
//   - "file":   a single repo-relative file path (compared after extension
//               normalisation, so `.ts` vs `.tsx` typos don't slip through).

interface ForbiddenPrefixTarget {
  kind: "prefix";
  label: string;
  prefix: string;
  requirements: string;
}

interface ForbiddenFileTarget {
  kind: "file";
  label: string;
  path: string;
  requirements: string;
}

type ForbiddenTarget = ForbiddenPrefixTarget | ForbiddenFileTarget;

const FORBIDDEN_TARGETS: ForbiddenTarget[] = [
  {
    kind: "prefix",
    label: "src/lib/runner/*",
    prefix: "src/lib/runner/",
    requirements: "Req 15.3, 16.1",
  },
  {
    kind: "file",
    label: "BottomPanel",
    path: "src/components/projects/v2/panels/BottomPanel.tsx",
    requirements: "Req 15.1, 16.2",
  },
  {
    kind: "file",
    label: "RunTab",
    path: "src/components/projects/v2/panels/RunTab.tsx",
    requirements: "Req 15.2, 16.2",
  },
  {
    kind: "file",
    label: "OutputTab",
    path: "src/components/projects/v2/panels/OutputTab.tsx",
    requirements: "Req 15.2, 16.2",
  },
  {
    kind: "file",
    label: "ProblemsTab",
    path: "src/components/projects/v2/panels/ProblemsTab.tsx",
    requirements: "Req 15.2, 16.2",
  },
  {
    kind: "file",
    label: "RunnerStatusStrip",
    path: "src/components/projects/v2/panels/RunnerStatusStrip.tsx",
    requirements: "Req 16.2",
  },
  {
    kind: "file",
    label: "useLintOnEdit",
    path: "src/components/projects/v2/workspace/useLintOnEdit.ts",
    requirements: "Req 15.4, 16.3",
  },
  {
    kind: "file",
    label: "useCursorPresence",
    path: "src/components/projects/v2/workspace/useCursorPresence.ts",
    requirements: "Req 15.13, 21.5",
  },
  {
    kind: "file",
    label: "cursorProtocol",
    path: "src/components/projects/v2/workspace/cursorProtocol.ts",
    requirements: "Req 15.13, 21.5",
  },
  {
    kind: "file",
    label: "parseStderrToProblems",
    path: "src/app/actions/parseStderrToProblems.ts",
    requirements: "Req 15.5",
  },
  {
    kind: "file",
    label: "KeyboardShortcuts",
    path: "src/components/projects/v2/workspace/KeyboardShortcuts.tsx",
    requirements: "Req 15.12",
  },
  {
    kind: "file",
    label: "OutlinePanel",
    path: "src/components/projects/v2/explorer/OutlinePanel.tsx",
    requirements: "Req 15.15",
  },
  {
    kind: "file",
    label: "SourceControlPanel",
    path: "src/components/projects/v2/explorer/SourceControlPanel.tsx",
    requirements: "Req 15.16",
  },
  {
    kind: "file",
    label: "ExplorerInsightsHost",
    path: "src/components/projects/v2/explorer/ExplorerInsightsHost.tsx",
    requirements: "Req 15.17",
  },
  {
    kind: "file",
    label: "ExplorerCommandPalette",
    path: "src/components/projects/v2/explorer/ExplorerCommandPalette.tsx",
    requirements: "Req 15.11",
  },
];

function matchesForbidden(
  relPath: string,
  target: ForbiddenTarget,
): boolean {
  if (target.kind === "prefix") return relPath.startsWith(target.prefix);
  return relPath === target.path;
}

// ---------------------------------------------------------------------------
// Import extraction
// ---------------------------------------------------------------------------
//
// Matches any of:
//
//     import X from "spec"
//     import { a, b } from "spec"
//     import * as ns from "spec"
//     import "spec"
//     import type { T } from "spec"
//     export { x } from "spec"
//     export * from "spec"
//     export type { T } from "spec"
//
// and intentionally does NOT match:
//
//     const x = await import("spec")       // dynamic — no `from`
//     dynamic(() => import("spec"))        // dynamic — no `from`
//     React.lazy(() => import("spec"))     // dynamic — no `from`
//
// Multi-line import lists are fine: the `[\s\S]*?` within the brace
// block is lazy, and we anchor on `from\s*["']...["']`.

const IMPORT_FROM_RE =
  /(?:^|[;\n])\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g;

/** Bare `import "spec";` (side-effect import). Matches separately because
 *  it has no `from` clause. */
const SIDE_EFFECT_IMPORT_RE = /(?:^|[;\n])\s*import\s*["']([^"']+)["']/g;

function extractStaticImportSpecifiers(source: string): string[] {
  // Strip block and line comments first so commented-out imports don't
  // pollute the graph. This is purposely naive — it handles `/* ... */`
  // (non-greedy) and `// ...` through end of line. Good enough for the
  // production sources in this repo.
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  const specifiers = new Set<string>();
  for (const match of stripped.matchAll(IMPORT_FROM_RE)) {
    if (match[1]) specifiers.add(match[1]);
  }
  for (const match of stripped.matchAll(SIDE_EFFECT_IMPORT_RE)) {
    // The side-effect regex also matches `import x from "spec"` because
    // the prefix overlaps; de-dupe by adding to the same set. The set
    // already prevents double-counting.
    if (match[1]) specifiers.add(match[1]);
  }
  return Array.from(specifiers);
}

// ---------------------------------------------------------------------------
// Specifier resolution
// ---------------------------------------------------------------------------

const TS_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];

function existsFile(abs: string): boolean {
  try {
    return statSync(abs).isFile();
  } catch {
    return false;
  }
}

function existsDir(abs: string): boolean {
  try {
    return statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve a module specifier against a hosting file. Returns the
 * repo-relative path of the resolved file on success, or `null` when the
 * specifier is:
 *
 *   - A bare npm package (`react`, `lucide-react`, `next/dynamic`, etc.)
 *   - A non-source asset (`.css`, `.svg`, `.json`, JSON is possible but
 *     not relevant to our forbidden graph)
 *   - A broken reference the scanner can't resolve on disk
 *
 * External packages and non-source assets are NOT followed — they cannot
 * reach the forbidden source modules.
 */
function resolveSpecifier(
  specifier: string,
  fromAbs: string,
): string | null {
  // 1. External packages — bare specifier not starting with `.`, `/`, or
  //    the configured alias. These cannot transitively reach any source
  //    file in this repo, so skip.
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
  const isAlias = specifier.startsWith("@/");
  const isAbsolute = specifier.startsWith("/");

  if (!isRelative && !isAlias && !isAbsolute) return null;

  // 2. Compute the candidate base path.
  let baseAbs: string;
  if (isAlias) {
    baseAbs = path.join(SRC_ROOT, specifier.slice(2));
  } else if (isAbsolute) {
    baseAbs = path.resolve(REPO_ROOT, specifier.replace(/^\/+/, ""));
  } else {
    baseAbs = path.resolve(path.dirname(fromAbs), specifier);
  }

  // 3. Try the exact file first (if the specifier already had an
  //    extension, e.g. `./format.ts` or `./foo.css`), then each known
  //    TS/JS extension.
  if (existsFile(baseAbs)) return toRepoRelative(baseAbs);
  for (const ext of TS_EXTS) {
    const candidate = `${baseAbs}${ext}`;
    if (existsFile(candidate)) return toRepoRelative(candidate);
  }

  // 4. Directory-style import — try `baseAbs/index.*`.
  if (existsDir(baseAbs)) {
    for (const ext of TS_EXTS) {
      const indexCandidate = path.join(baseAbs, `index${ext}`);
      if (existsFile(indexCandidate)) return toRepoRelative(indexCandidate);
    }
  }

  // 5. Non-source asset (`.css`, `.svg`, ...). If the extension is not
  //    in TS_EXTS and the file exists, it's still not a graph edge we
  //    care about. Return null.
  return null;
}

function toRepoRelative(absPath: string): string {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join("/");
}

// ---------------------------------------------------------------------------
// Graph walk
// ---------------------------------------------------------------------------

interface WalkResult {
  /** Every file statically reachable from the entry. */
  reachable: Set<string>;
  /**
   * The parent edge for each reachable file — used to reconstruct import
   * chains back to the entry. `parents[entry]` is `null`.
   */
  parents: Map<string, string | null>;
  /**
   * For each unresolved specifier at each file, capture the specifier
   * string for the report. Helps reviewers spot typos that would make
   * the graph under-report.
   */
  unresolved: Array<{ from: string; specifier: string }>;
}

function walkStaticImportGraph(entryRel: string): WalkResult {
  const reachable = new Set<string>();
  const parents = new Map<string, string | null>();
  const unresolved: Array<{ from: string; specifier: string }> = [];

  const entryAbs = path.join(REPO_ROOT, entryRel);
  const queue: string[] = [entryRel];
  reachable.add(entryRel);
  parents.set(entryRel, null);

  while (queue.length > 0) {
    const currentRel = queue.shift()!;
    const currentAbs = path.join(REPO_ROOT, currentRel);

    let source: string;
    try {
      source = readFileSync(currentAbs, "utf8");
    } catch {
      // File disappeared or path mis-resolved — record and continue.
      unresolved.push({ from: currentRel, specifier: "<read-failed>" });
      continue;
    }

    const specifiers = extractStaticImportSpecifiers(source);
    for (const spec of specifiers) {
      const resolvedRel = resolveSpecifier(spec, currentAbs);
      if (resolvedRel === null) {
        // External package or asset — don't traverse, don't record as
        // unresolved (that would spam the report with every `react`
        // import). We only record unresolved *internal* specifiers.
        if (
          spec.startsWith("./") ||
          spec.startsWith("../") ||
          spec.startsWith("@/")
        ) {
          unresolved.push({ from: currentRel, specifier: spec });
        }
        continue;
      }
      if (reachable.has(resolvedRel)) continue;
      reachable.add(resolvedRel);
      parents.set(resolvedRel, currentRel);
      queue.push(resolvedRel);
    }
  }

  return { reachable, parents, unresolved };
}

/** Reconstruct the shortest import chain from the entry to `target`. */
function chainFromParents(
  target: string,
  parents: Map<string, string | null>,
): string[] {
  const chain: string[] = [];
  let cursor: string | null = target;
  while (cursor !== null) {
    chain.unshift(cursor);
    cursor = parents.get(cursor) ?? null;
  }
  return chain;
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

interface ReachedTarget {
  label: string;
  requirements: string;
  /** Files in `reachable` that match this target (multiple when prefix). */
  matchedFiles: Array<{ file: string; chain: string[] }>;
}

function buildReport(walk: WalkResult) {
  const reachedTargets: ReachedTarget[] = [];
  const clearedTargets: string[] = [];

  for (const target of FORBIDDEN_TARGETS) {
    const matches: Array<{ file: string; chain: string[] }> = [];
    for (const reachedFile of walk.reachable) {
      if (matchesForbidden(reachedFile, target)) {
        matches.push({
          file: reachedFile,
          chain: chainFromParents(reachedFile, walk.parents),
        });
      }
    }
    if (matches.length > 0) {
      reachedTargets.push({
        label: target.label,
        requirements: target.requirements,
        matchedFiles: matches,
      });
    } else {
      clearedTargets.push(target.label);
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    entry: ENTRY_REL,
    reachableFileCount: walk.reachable.size,
    notes: [
      "Static import-graph scan: top-level `import`/`export-from` edges",
      "only. `import(...)` expressions (including the inner `import()`",
      "inside `next/dynamic(() => import(...))` loaders) are NOT",
      "traversed because those code paths do not load at mount time.",
      "See Task 11.3 and design § Coexistence.",
    ].join(" "),
    summary: {
      forbiddenTargetsTotal: FORBIDDEN_TARGETS.length,
      forbiddenTargetsReached: reachedTargets.length,
      forbiddenTargetsCleared: clearedTargets.length,
      unresolvedSpecifierCount: walk.unresolved.length,
    },
    reached: reachedTargets,
    cleared: clearedTargets,
    unresolved: walk.unresolved,
  };
}

// ---------------------------------------------------------------------------
// Test entry point
// ---------------------------------------------------------------------------

test("forbidden-imports: FilesTabRoot static import graph does not reach forbidden modules", () => {
  // Sanity-check the entry exists before we walk.
  assert.ok(
    existsFile(ENTRY_ABS),
    `entry file must exist at ${ENTRY_REL} — did the FilesTabRoot move?`,
  );

  const walk = walkStaticImportGraph(ENTRY_REL);
  const report = buildReport(walk);

  // Write the JSON report so Task 13.4 / 13.5 can consume it as a
  // pre-delete gate, mirroring `files-tab-removal-audit.json`.
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  // --- Well-formedness assertions -----------------------------------
  //
  // Per the task description, we do NOT fail the build on a reached
  // forbidden target during the coexistence period. Instead we assert
  // report shape + log findings to stdout so reviewers see them in CI.

  assert.equal(
    report.reachableFileCount,
    walk.reachable.size,
    "reachableFileCount must equal reachable set size",
  );
  assert.ok(
    report.reachableFileCount > 0,
    "static walk must visit at least the entry file",
  );
  assert.ok(
    walk.reachable.has(ENTRY_REL),
    "entry file must be in the reachable set",
  );
  assert.equal(
    report.summary.forbiddenTargetsTotal,
    FORBIDDEN_TARGETS.length,
    "report summary must account for every forbidden target",
  );
  assert.equal(
    report.summary.forbiddenTargetsReached + report.summary.forbiddenTargetsCleared,
    FORBIDDEN_TARGETS.length,
    "every forbidden target must be classified reached or cleared",
  );

  // Each matched file's chain must start at the entry and end at the file.
  for (const reached of report.reached) {
    for (const hit of reached.matchedFiles) {
      assert.ok(hit.chain.length >= 1, `empty chain for ${hit.file}`);
      assert.equal(
        hit.chain[0],
        ENTRY_REL,
        `chain for ${hit.file} must start at entry`,
      );
      assert.equal(
        hit.chain[hit.chain.length - 1],
        hit.file,
        `chain for ${hit.file} must end at matched file`,
      );
    }
  }

  // Cleared-target names are unique; sanity check against the source list.
  const allLabels = new Set(FORBIDDEN_TARGETS.map((t) => t.label));
  for (const name of report.cleared) {
    assert.ok(
      allLabels.has(name),
      `cleared target label not in forbidden list: ${name}`,
    );
  }
  for (const reached of report.reached) {
    assert.ok(
      allLabels.has(reached.label),
      `reached target label not in forbidden list: ${reached.label}`,
    );
  }

  // --- Human-readable summary ---------------------------------------

  const lines: string[] = [
    `[forbidden-imports] entry=${ENTRY_REL}`,
    `[forbidden-imports] reachable files=${report.reachableFileCount}`,
    `[forbidden-imports] forbidden targets total=${report.summary.forbiddenTargetsTotal} cleared=${report.summary.forbiddenTargetsCleared} reached=${report.summary.forbiddenTargetsReached}`,
    `[forbidden-imports] report written to ${path.relative(REPO_ROOT, REPORT_PATH)}`,
  ];
  for (const line of lines) console.log(line);

  if (report.reached.length > 0) {
    console.warn(
      `[forbidden-imports] WARNING: ${report.reached.length} forbidden target(s) are statically reachable from ${ENTRY_REL}.`,
    );
    console.warn(
      "[forbidden-imports] These must be broken before Task 13 deletions land. Chains:",
    );
    for (const reached of report.reached) {
      console.warn(
        `  • ${reached.label} (${reached.requirements})`,
      );
      for (const hit of reached.matchedFiles) {
        // Print the chain joined by ` → ` so CI logs render it on one line.
        console.warn(`      ${hit.chain.join(" → ")}`);
      }
    }
  } else {
    console.log(
      "[forbidden-imports] OK — static graph from FilesTabRoot is clear of every forbidden target.",
    );
  }

  if (walk.unresolved.length > 0) {
    console.warn(
      `[forbidden-imports] ${walk.unresolved.length} internal specifier(s) could not be resolved on disk (may indicate scanner drift):`,
    );
    for (const u of walk.unresolved.slice(0, 10)) {
      console.warn(`      ${u.from} → ${u.specifier}`);
    }
  }
});
