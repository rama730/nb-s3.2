// Task 1.5 — `patchNodeVersion` store action unit test.
//
// Verifies (per design.md § Unit Tests):
//   (i)   `patchNodeVersion` patches `nodesById[nodeId].currentVersion` in place
//   (ii)  `patchNodeVersion` bumps `treeVersion` by 1
//   (iii) `patchNodeVersion` does NOT rebuild children or folder meta
//   (iv)  `setTaskLinkCounts` accepts zero values (removes TaskLinkChip on unlink)
//
// Requirements: 3.4, 3.5, 3.7

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import type { ProjectNode } from "@/lib/db/schema";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { hasNodeCacheDifference } from "@/stores/files/explorerSlice";
import { defaultWorkspace } from "@/stores/files/types";

// ─── Fixture builders ────────────────────────────────────────────────

const PROJECT_ID = "proj-test";

function makeFile(id: string, name: string, parentId: string | null, currentVersion = 1): ProjectNode {
  return {
    id,
    projectId: PROJECT_ID,
    parentId,
    path: "/",
    type: "file",
    name,
    s3Key: `s3/${id}`,
    size: 100,
    mimeType: "text/plain",
    currentVersion,
    metadata: {},
    gitHash: null,
    createdBy: null,
    deletedBy: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
  } as unknown as ProjectNode;
}

function seedWorkspace(nodes: ProjectNode[], childrenByParentId?: Record<string, string[]>) {
  const nodesById: Record<string, ProjectNode> = {};
  for (const n of nodes) nodesById[n.id] = n;

  const ws = {
    ...defaultWorkspace(),
    nodesById,
    childrenByParentId: childrenByParentId ?? { __root__: nodes.map((n) => n.id) },
    treeVersion: 5,
  };

  useFilesWorkspaceStore.setState((state) => ({
    byProjectId: { ...state.byProjectId, [PROJECT_ID]: ws },
  }));
}

function getWs() {
  return useFilesWorkspaceStore.getState().byProjectId[PROJECT_ID]!;
}

// ─── Reset ───────────────────────────────────────────────────────────

beforeEach(() => {
  useFilesWorkspaceStore.setState({ byProjectId: {} });
});

// ─── patchNodeVersion ────────────────────────────────────────────────

describe("patchNodeVersion — patches currentVersion in place (Req 3.5)", () => {
  it("updates the node's currentVersion to the provided value", () => {
    const file = makeFile("file-1", "readme.md", null, 3);
    seedWorkspace([file]);

    useFilesWorkspaceStore.getState().patchNodeVersion(PROJECT_ID, "file-1", 7);

    const node = getWs().nodesById["file-1"];
    assert.equal(node.currentVersion, 7, "currentVersion should be patched to 7");
  });

  it("bumps treeVersion by exactly 1", () => {
    const file = makeFile("file-1", "readme.md", null, 1);
    seedWorkspace([file]);

    const before = getWs().treeVersion;
    useFilesWorkspaceStore.getState().patchNodeVersion(PROJECT_ID, "file-1", 2);
    const after = getWs().treeVersion;

    assert.equal(after, before + 1, "treeVersion should increment by 1");
  });

  it("does NOT rebuild childrenByParentId", () => {
    const file = makeFile("file-1", "readme.md", null, 1);
    const children = { __root__: ["file-1"], "folder-a": ["file-2"] };
    seedWorkspace([file], children);

    const childrenBefore = getWs().childrenByParentId;
    useFilesWorkspaceStore.getState().patchNodeVersion(PROJECT_ID, "file-1", 5);
    const childrenAfter = getWs().childrenByParentId;

    assert.deepEqual(childrenAfter, childrenBefore, "childrenByParentId must not change");
  });

  it("does NOT rebuild folderMeta", () => {
    const file = makeFile("file-1", "readme.md", null, 1);
    seedWorkspace([file]);

    // Seed some folderMeta
    useFilesWorkspaceStore.setState((state) => ({
      byProjectId: {
        ...state.byProjectId,
        [PROJECT_ID]: {
          ...state.byProjectId[PROJECT_ID]!,
          folderMeta: { __root__: { nextCursor: "abc", hasMore: true } },
        },
      },
    }));

    const metaBefore = getWs().folderMeta;
    useFilesWorkspaceStore.getState().patchNodeVersion(PROJECT_ID, "file-1", 3);
    const metaAfter = getWs().folderMeta;

    assert.deepEqual(metaAfter, metaBefore, "folderMeta must not change");
  });

  it("is a no-op when projectId does not exist", () => {
    const file = makeFile("file-1", "readme.md", null, 1);
    seedWorkspace([file]);

    const stateBefore = useFilesWorkspaceStore.getState();
    useFilesWorkspaceStore.getState().patchNodeVersion("nonexistent-project", "file-1", 99);
    const stateAfter = useFilesWorkspaceStore.getState();

    assert.equal(stateBefore, stateAfter, "state reference should not change for unknown project");
  });

  it("is a no-op when nodeId does not exist in the project", () => {
    const file = makeFile("file-1", "readme.md", null, 1);
    seedWorkspace([file]);

    const stateBefore = useFilesWorkspaceStore.getState();
    useFilesWorkspaceStore.getState().patchNodeVersion(PROJECT_ID, "nonexistent-node", 99);
    const stateAfter = useFilesWorkspaceStore.getState();

    assert.equal(stateBefore, stateAfter, "state reference should not change for unknown node");
  });
});

describe("upsertNodes — keeps active-version attribution coherent", () => {
  it("detects authoritative attribution changes even when the node timestamp is unchanged", () => {
    const file = Object.assign(makeFile("file-1", "readme.md", null, 11), {
      updatedByName: "Old editor",
      versionUpdatedAt: new Date("2026-06-22T00:00:00Z"),
    });

    const enriched = Object.assign({ ...file }, {
      updatedById: "user-rama",
      updatedByName: "Rama",
      versionUpdatedAt: new Date("2026-07-02T09:30:15Z"),
    });

    assert.equal(hasNodeCacheDifference(file, enriched), true);
    assert.equal(hasNodeCacheDifference(enriched, { ...enriched }), false);
  });
});

// ─── setTaskLinkCounts — zero values (Req 3.7) ──────────────────────

describe("setTaskLinkCounts — accepts zero values for unlink (Req 3.7)", () => {
  it("writes zero values to the store (does not filter them)", () => {
    seedWorkspace([]);

    // First set a non-zero count
    useFilesWorkspaceStore.getState().setTaskLinkCounts(PROJECT_ID, { "node-a": 3 });
    assert.equal(getWs().taskLinkCounts["node-a"], 3);

    // Now set it to zero — should write 0, not delete the key
    useFilesWorkspaceStore.getState().setTaskLinkCounts(PROJECT_ID, { "node-a": 0 });
    assert.equal(getWs().taskLinkCounts["node-a"], 0, "zero must be written, not filtered");
  });

  it("merges counts without removing existing entries", () => {
    seedWorkspace([]);

    useFilesWorkspaceStore.getState().setTaskLinkCounts(PROJECT_ID, { "node-a": 2, "node-b": 5 });
    useFilesWorkspaceStore.getState().setTaskLinkCounts(PROJECT_ID, { "node-b": 0, "node-c": 1 });

    const counts = getWs().taskLinkCounts;
    assert.equal(counts["node-a"], 2, "node-a should remain unchanged");
    assert.equal(counts["node-b"], 0, "node-b should be set to zero");
    assert.equal(counts["node-c"], 1, "node-c should be added");
  });

  it("is a no-op when projectId does not exist", () => {
    seedWorkspace([]);

    const stateBefore = useFilesWorkspaceStore.getState();
    useFilesWorkspaceStore.getState().setTaskLinkCounts("nonexistent-project", { "x": 1 });
    const stateAfter = useFilesWorkspaceStore.getState();

    assert.equal(stateBefore, stateAfter, "state reference should not change for unknown project");
  });
});
