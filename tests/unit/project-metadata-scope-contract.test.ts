import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.join(process.cwd(), "src/lib/projects/project-detail-metadata-lookup.ts"),
  "utf8",
);

describe("project detail metadata scoping", () => {
  it("scopes file metadata lookups to the resolved project", () => {
    assert.match(source, /eq\(projectNodes\.id, fileId\)[\s\S]*eq\(projectNodes\.projectId, projectId\)/);
  });

  it("scopes UUID and human task-key lookups to the resolved project", () => {
    assert.match(source, /eq\(tasks\.projectId, projectId\)/);
    assert.match(source, /isUuid \? eq\(tasks\.id, drawerId\) : eq\(tasks\.taskNumber, taskNumber!\)/);
    assert.doesNotMatch(source, /innerJoin\(projects/);
  });
});
