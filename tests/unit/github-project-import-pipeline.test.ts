import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const PROJECT_ACTIONS_SRC = readFileSync(
  path.resolve(__dirname, "../../src/app/actions/project/_all.ts"),
  "utf8",
);

const PROJECT_IMPORT_FUNCTION_SRC = readFileSync(
  path.resolve(__dirname, "../../src/inngest/functions/project-import.ts"),
  "utf8",
);

const IMPORT_UTILS_SRC = readFileSync(
  path.resolve(__dirname, "../../src/lib/import/utils.ts"),
  "utf8",
);

test("GitHub project import enqueue has a local inline fallback", () => {
  assert.match(
    PROJECT_ACTIONS_SRC,
    /import\s*\{\s*runGithubProjectImport\s*\}\s*from\s*['"]@\/lib\/github\/project-import-runner['"]/,
    "project actions must import the shared GitHub import runner",
  );
  assert.match(
    PROJECT_ACTIONS_SRC,
    /function\s+shouldRunGithubImportInlineFallback/,
    "project actions must decide when queue failures can fall back to inline import",
  );
  assert.match(
    PROJECT_ACTIONS_SRC,
    /GITHUB_IMPORT_INLINE_FALLBACK/,
    "the inline fallback must be explicitly configurable",
  );
  assert.match(
    PROJECT_ACTIONS_SRC,
    /runGithubProjectImport\s*\(/,
    "queue failure fallback must execute the shared import runner",
  );

  const dispatchCallCount =
    PROJECT_ACTIONS_SRC.match(/enqueueGithubImportOrRunInline\s*\(/g)?.length ??
    0;
  assert.equal(
    dispatchCallCount,
    3,
    "the helper definition plus create/retry call sites must use the same dispatch path",
  );
});

test("Inngest project import function delegates to the shared runner", () => {
  assert.match(
    PROJECT_IMPORT_FUNCTION_SRC,
    /runGithubProjectImport/,
    "Inngest project import must use the same runner as inline fallback",
  );
  assert.doesNotMatch(
    PROJECT_IMPORT_FUNCTION_SRC,
    /git\s*clone|uploadRepoFiles|createDirectoryStructureFromRoot/,
    "worker orchestration should stay in the shared runner, not be duplicated in the Inngest function",
  );
});

test("repository import persists materialized node paths", () => {
  assert.match(
    IMPORT_UTILS_SRC,
    /const\s+nodePath\s*=\s*`\/\$\{item\.dirPath\}`/,
    "imported folders must receive materialized paths",
  );
  assert.match(
    IMPORT_UTILS_SRC,
    /path:\s*nodePath/,
    "folder inserts must persist the computed materialized path",
  );
  assert.match(
    IMPORT_UTILS_SRC,
    /const\s+nodePath\s*=\s*`\/\$\{rel\}`/,
    "imported files must compute a materialized path from the repository-relative path",
  );
  assert.match(
    IMPORT_UTILS_SRC,
    /path:\s*item\.path/,
    "file inserts must persist the computed materialized path",
  );
  assert.match(
    IMPORT_UTILS_SRC,
    /SET\s+path\s*=\s*v\.path/,
    "existing imported nodes must have stale materialized paths repaired on re-import",
  );
});
