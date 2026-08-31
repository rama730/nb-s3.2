import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("project preflight and finalization ignore soft-deleted tasks", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/app/actions/project/_all.ts"),
    "utf8",
  );
  const unfinishedPredicates = source.match(
    /eq\(tasks\.projectId, projectId\),\s*isNull\(tasks\.deletedAt\),\s*sql`\$\{tasks\.status\} <> 'done'`/g,
  ) ?? [];

  assert.ok(unfinishedPredicates.length >= 2);
});
