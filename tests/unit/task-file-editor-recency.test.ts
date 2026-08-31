import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("file-version notifications choose editors by their latest edit time", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/lib/notifications/task-file.ts"),
    "utf8",
  );

  assert.match(source, /SELECT DISTINCT ON \(uploaded_by\) uploaded_by, uploaded_at/);
  assert.match(source, /\) recent_editors\s+ORDER BY uploaded_at DESC, uploaded_by\s+LIMIT 5/);
});
