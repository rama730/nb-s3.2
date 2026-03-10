import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ProjectNode } from "../../src/lib/db/schema";
import { enforceNodesBudget } from "../../src/stores/files/filesSlice";

function makeNode(id: string, updatedAtMs: number): ProjectNode {
  return {
    id,
    name: id,
    type: "file",
    projectId: "project-1",
    parentId: null,
    path: `/${id}`,
    mimeType: "text/plain",
    size: 1,
    s3Key: null,
    createdBy: null,
    deletedBy: null,
    isCommitted: false,
    contentHash: null,
    embeddingUpdatedAt: null,
    lastIndexedAt: null,
    deletedAt: null,
    createdAt: new Date(updatedAtMs - 10),
    updatedAt: new Date(updatedAtMs),
  } as unknown as ProjectNode;
}

describe("enforceNodesBudget", () => {
  it("keeps the most recent nodes and prunes stale child references", () => {
    const nodesById = {
      a: makeNode("a", 1000),
      b: makeNode("b", 3000),
      c: makeNode("c", 2000),
    };
    const childrenByParentId = {
      __root__: ["a", "b", "c"],
      folderA: ["a"],
    };

    const budgeted = enforceNodesBudget(nodesById, childrenByParentId, 2);
    assert.deepEqual(Object.keys(budgeted.nodesById).sort(), ["b", "c"]);
    assert.deepEqual(budgeted.childrenByParentId.__root__, ["b", "c"]);
    assert.deepEqual(budgeted.childrenByParentId.folderA, []);
  });

  it("does not mutate existing maps when under budget", () => {
    const nodesById = {
      a: makeNode("a", 1000),
      b: makeNode("b", 2000),
    };
    const childrenByParentId = {
      __root__: ["a", "b"],
    };

    const budgeted = enforceNodesBudget(nodesById, childrenByParentId, 10);
    assert.equal(budgeted.nodesById, nodesById);
    assert.equal(budgeted.childrenByParentId, childrenByParentId);
    assert.deepEqual(budgeted.childrenByParentId.__root__, ["a", "b"]);
  });
});
