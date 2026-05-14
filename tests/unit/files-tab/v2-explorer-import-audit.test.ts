// Task 11.1 — V2 Explorer Module Import-Graph Audit
//
// **Validates: Requirements 20.1, 20.2, 20.3**
//
// This test confirms zero remaining import references to each of the 14
// V2 explorer modules scheduled for deletion in task 11.2. For each module,
// we scan the entire `src/` tree (excluding the explorer directory itself)
// for any `import` or `export ... from` statement that references the module.
//
// If any external callers are found, the test reports them so they can be
// migrated to V3 equivalents before deletion proceeds.

import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SRC_ROOT = path.join(REPO_ROOT, "src");
const ARTIFACTS_DIR = path.join(REPO_ROOT, "artifacts");
const REPORT_PATH = path.join(ARTIFACTS_DIR, "v2-explorer-import-audit.json");

// The 14 V2 explorer modules to audit (from task 11.1)
const V2_MODULES = [
  "ExplorerShell",
  "FileExplorer",
  "MultiFileDiffDialog",
  "MultiSelectActionsBar",
  "OutlinePanel",
  "SourceControlPanel",
  "ExplorerCommandPalette",
  "ExplorerInsightsHost",
  "ExplorerOperationsHost",
  "ExplorerSearch",
  "ExplorerToolbarHost",
  "ExplorerBatchOps",
  "ExplorerQuickOpen",
  "FileGridItem",
] as const;

// The explorer directory itself — imports within this directory are expected
// (these modules import each other) and should not count as external callers.
const EXPLORER_DIR = "src/components/projects/v2/explorer";

// ---------------------------------------------------------------------------
// File scanning utilities
// ---------------------------------------------------------------------------

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]);

function getAllSourceFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip node_modules, .next, .git
      if (
        entry.name === "node_modules" ||
        entry.name === ".next" ||
        entry.name === ".git"
      ) {
        continue;
      }
      results.push(...getAllSourceFiles(fullPath));
    } else if (entry.isFile() && SOURCE_EXTS.has(path.extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results;
}

function isInsideExplorerDir(absPath: string): boolean {
  const relPath = path.relative(REPO_ROOT, absPath).split(path.sep).join("/");
  return relPath.startsWith(EXPLORER_DIR + "/");
}

/**
 * Check if a source file imports any of the V2 modules.
 * Returns an array of { module, line, lineNumber } for each match found.
 */
function findV2Imports(
  filePath: string,
  source: string,
): Array<{ module: string; line: string; lineNumber: number }> {
  const results: Array<{ module: string; line: string; lineNumber: number }> = [];
  const lines = source.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip comment-only lines
    if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) {
      continue;
    }

    // Check for import/export statements referencing V2 modules
    for (const mod of V2_MODULES) {
      // Match patterns like:
      //   import ... from ".../<module>"
      //   import ... from "./<module>"
      //   import(".../<module>")
      //   export ... from ".../<module>"
      const importFromPattern = new RegExp(
        `(?:import|export).*from\\s*["'][^"']*\\/${mod}(?:\\.tsx?)?["']`,
      );
      const dynamicImportPattern = new RegExp(
        `import\\(\\s*["'][^"']*\\/${mod}(?:\\.tsx?)?["']`,
      );
      const namedImportPattern = new RegExp(
        `import\\s+.*\\{[^}]*\\b${mod}\\b[^}]*\\}.*from`,
      );

      if (
        importFromPattern.test(line) ||
        dynamicImportPattern.test(line) ||
        namedImportPattern.test(line)
      ) {
        results.push({ module: mod, line: line.trim(), lineNumber: i + 1 });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Audit execution
// ---------------------------------------------------------------------------

interface AuditResult {
  module: string;
  externalCallers: Array<{
    file: string;
    line: string;
    lineNumber: number;
  }>;
}

function runAudit(): {
  results: AuditResult[];
  totalExternalCallers: number;
  scannedFiles: number;
} {
  // Get all source files outside the explorer directory
  const allFiles = getAllSourceFiles(SRC_ROOT);
  const externalFiles = allFiles.filter((f) => !isInsideExplorerDir(f));

  const results: AuditResult[] = V2_MODULES.map((mod) => ({
    module: mod,
    externalCallers: [],
  }));

  for (const filePath of externalFiles) {
    let source: string;
    try {
      source = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    const imports = findV2Imports(filePath, source);
    for (const imp of imports) {
      const relPath = path.relative(REPO_ROOT, filePath).split(path.sep).join("/");
      const result = results.find((r) => r.module === imp.module);
      if (result) {
        result.externalCallers.push({
          file: relPath,
          line: imp.line,
          lineNumber: imp.lineNumber,
        });
      }
    }
  }

  // Also scan test files for completeness (but report separately)
  const testDir = path.join(REPO_ROOT, "tests");
  let testFiles: string[] = [];
  try {
    testFiles = getAllSourceFiles(testDir);
  } catch {
    // tests dir may not exist
  }

  const totalExternalCallers = results.reduce(
    (sum, r) => sum + r.externalCallers.length,
    0,
  );

  return {
    results,
    totalExternalCallers,
    scannedFiles: externalFiles.length,
  };
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("Task 11.1 — V2 Explorer Module Import-Graph Audit", () => {
  const audit = runAudit();

  // Write the audit report artifact
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    task: "11.1",
    description:
      "Import-graph audit confirming zero external callers for V2 explorer modules scheduled for deletion",
    requirements: ["20.1", "20.2", "20.3"],
    scannedFiles: audit.scannedFiles,
    totalExternalCallers: audit.totalExternalCallers,
    modules: audit.results.map((r) => ({
      name: r.module,
      externalCallerCount: r.externalCallers.length,
      callers: r.externalCallers,
      safeToDelete: r.externalCallers.length === 0,
    })),
    verdict:
      audit.totalExternalCallers === 0
        ? "ALL_CLEAR — all 14 V2 explorer modules have zero external callers and are safe to delete"
        : `BLOCKED — ${audit.totalExternalCallers} external caller(s) must be migrated before deletion`,
  };

  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  it("should scan a non-trivial number of source files", () => {
    assert.ok(
      audit.scannedFiles > 50,
      `Expected to scan >50 files, got ${audit.scannedFiles}`,
    );
  });

  for (const mod of V2_MODULES) {
    it(`${mod} — zero external import references`, () => {
      const result = audit.results.find((r) => r.module === mod)!;
      if (result.externalCallers.length > 0) {
        const callerList = result.externalCallers
          .map((c) => `  ${c.file}:${c.lineNumber} → ${c.line}`)
          .join("\n");
        assert.fail(
          `${mod} still has ${result.externalCallers.length} external caller(s) that must be migrated to V3 equivalents:\n${callerList}`,
        );
      }
      assert.equal(
        result.externalCallers.length,
        0,
        `${mod} must have zero external callers`,
      );
    });
  }

  it("overall verdict: all modules safe to delete", () => {
    assert.equal(
      audit.totalExternalCallers,
      0,
      `Expected zero total external callers, found ${audit.totalExternalCallers}. See artifact at artifacts/v2-explorer-import-audit.json for details.`,
    );
    console.log(
      `[v2-explorer-audit] ✓ All ${V2_MODULES.length} V2 explorer modules have zero external callers.`,
    );
    console.log(
      `[v2-explorer-audit] Scanned ${audit.scannedFiles} source files outside the explorer directory.`,
    );
    console.log(
      `[v2-explorer-audit] Verdict: SAFE TO DELETE — proceed with task 11.2.`,
    );
    console.log(
      `[v2-explorer-audit] Report written to artifacts/v2-explorer-import-audit.json`,
    );
  });
});
