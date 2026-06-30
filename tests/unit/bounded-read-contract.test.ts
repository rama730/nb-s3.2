import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";

function read(file: string) {
  return fs.readFileSync(file, "utf8");
}

describe("bounded read contracts", () => {
  it("paginates extension folder and import status reads with stable cursors", () => {
    for (const file of [
      "src/app/api/v1/extension/folder/route.ts",
      "src/app/api/v1/github/import/status/route.ts",
    ]) {
      const source = read(file);
      assert.match(source, /limit:\s*(?:parsed\.data\.)?limit \+ 1|\.limit\(limit \+ 1\)/);
      assert.match(source, /nextCursor/);
      assert.match(source, /hasMore/);
    }
    assert.match(
      read("src/app/api/v1/extension/folder/route.ts"),
      /eq\(tasks\.projectId, projectId\)/,
    );
  });

  it("keeps file-tree reads side-effect free and initialization explicit", () => {
    const source = read("src/app/actions/files/nodes.ts");
    const readStart = source.indexOf("export async function getProjectNodes");
    const initStart = source.indexOf("export async function initializeProjectWorkspaceRoot");
    assert.ok(readStart >= 0 && initStart > readStart);
    assert.doesNotMatch(source.slice(readStart, initStart), /\.insert\(|createProjectRoot/);
    assert.match(source.slice(initStart), /ensureSystemRootFolder\(projectId, user\.id/);
  });

  it("bounds active extension sessions and uses cursor pagination", () => {
    const source = read("src/lib/extension/active-sessions.ts");
    assert.match(source, /Math\.min\(100/);
    assert.match(source, /limit: limit \+ 1/);
    assert.match(source, /nextCursor/);
  });
});
