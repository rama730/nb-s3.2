// Tests for Files tab v3 navigation store additions.
//
// Task 1.4 — `currentLocationId` + `setCurrentLocation` must coexist with the
// legacy `selectedNodeId` / `selectedFolderId` keys so the Tasks tab file
// picker keeps working (Req 21.7). See
// .kiro/specs/files-tab-github-redesign/design.md § Store Changes / ADDED.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import type { ProjectNode } from "../../../src/lib/db/schema";
import { createWorkspaceSlice } from "../../../src/stores/files/workspaceSlice";
import {
  defaultWorkspace,
  type FilesWorkspaceState,
  type ProjectWorkspaceState,
} from "../../../src/stores/files/types";

// ─── Harness ─────────────────────────────────────────────────────────
// We mount the slice directly against a minimal mutable container instead of
// spinning up the full persisted zustand store. The action only needs `set`
// and `get` with the `byProjectId` map; this keeps the test hermetic and
// avoids loading the persist middleware / localStorage shim.

type MinimalState = Pick<FilesWorkspaceState, "byProjectId">;

function createHarness() {
  const container: MinimalState = { byProjectId: {} };

  const set: Parameters<typeof createWorkspaceSlice>[0] = (updater) => {
    const next =
      typeof updater === "function"
        ? (updater as (s: FilesWorkspaceState) => Partial<FilesWorkspaceState>)(
            container as FilesWorkspaceState,
          )
        : updater;
    Object.assign(container, next);
  };
  const get: Parameters<typeof createWorkspaceSlice>[1] = () =>
    container as FilesWorkspaceState;
  const api = {} as Parameters<typeof createWorkspaceSlice>[2];

  const slice = createWorkspaceSlice(set, get, api);

  return {
    container,
    setCurrentLocation: slice.setCurrentLocation,
    getWorkspace(projectId: string): ProjectWorkspaceState {
      return container.byProjectId[projectId]!;
    },
    seed(projectId: string, ws: ProjectWorkspaceState) {
      container.byProjectId = { ...container.byProjectId, [projectId]: ws };
    },
  };
}

function makeFolder(id: string, parentId: string | null): ProjectNode {
  return {
    id,
    projectId: "project-1",
    parentId,
    path: "/",
    type: "folder",
    name: id,
    s3Key: null,
    size: 0,
    mimeType: null,
    currentVersion: 1,
    metadata: {},
    gitHash: null,
    createdBy: null,
    deletedBy: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
  } as unknown as ProjectNode;
}

function makeFile(id: string, parentId: string | null): ProjectNode {
  return {
    id,
    projectId: "project-1",
    parentId,
    path: "/",
    type: "file",
    name: id,
    s3Key: `s3/${id}`,
    size: 1,
    mimeType: "text/plain",
    currentVersion: 1,
    metadata: {},
    gitHash: null,
    createdBy: null,
    deletedBy: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
  } as unknown as ProjectNode;
}

const PROJECT_ID = "project-1";

describe("files workspace store — currentLocationId (Task 1.4)", () => {
  describe("default state", () => {
    it("initializes currentLocationId to null", () => {
      const ws = defaultWorkspace();
      assert.equal(ws.currentLocationId, null);
    });
  });

  describe("setCurrentLocation", () => {
    let harness: ReturnType<typeof createHarness>;

    beforeEach(() => {
      harness = createHarness();
    });

    it("sets currentLocationId and bumps selectionVersion for a file deep in the tree", () => {
      // Tree: root -> foo (folder) -> bar (folder) -> baz.txt (file)
      const ws = defaultWorkspace();
      ws.nodesById = {
        foo: makeFolder("foo", null),
        bar: makeFolder("bar", "foo"),
        baz: makeFile("baz", "bar"),
      };
      harness.seed(PROJECT_ID, ws);
      const priorSelectionVersion = ws.selectionVersion;

      harness.setCurrentLocation(PROJECT_ID, "baz");

      const next = harness.getWorkspace(PROJECT_ID);
      assert.equal(next.currentLocationId, "baz");
      assert.equal(next.selectionVersion, priorSelectionVersion + 1);
    });

    it("expands every ancestor folder of the target node", () => {
      const ws = defaultWorkspace();
      ws.nodesById = {
        foo: makeFolder("foo", null),
        bar: makeFolder("bar", "foo"),
        baz: makeFile("baz", "bar"),
      };
      harness.seed(PROJECT_ID, ws);

      harness.setCurrentLocation(PROJECT_ID, "baz");

      const next = harness.getWorkspace(PROJECT_ID);
      // Both ancestor folders must be expanded so the file is visible.
      assert.equal(next.expandedFolderIds["foo"], true);
      assert.equal(next.expandedFolderIds["bar"], true);
    });

    it("preserves already-expanded folders and existing expand entries for other folders", () => {
      const ws = defaultWorkspace();
      ws.nodesById = {
        foo: makeFolder("foo", null),
        bar: makeFolder("bar", "foo"),
        baz: makeFile("baz", "bar"),
        qux: makeFolder("qux", null),
      };
      ws.expandedFolderIds = { foo: true, qux: false };
      harness.seed(PROJECT_ID, ws);

      harness.setCurrentLocation(PROJECT_ID, "baz");

      const next = harness.getWorkspace(PROJECT_ID);
      assert.equal(next.expandedFolderIds["foo"], true);
      assert.equal(next.expandedFolderIds["bar"], true);
      // Unrelated entries are left alone.
      assert.equal(next.expandedFolderIds["qux"], false);
    });

    it("does NOT modify selectedNodeId or selectedFolderId (Tasks tab coexistence — Req 21.7)", () => {
      const ws = defaultWorkspace();
      ws.nodesById = {
        foo: makeFolder("foo", null),
        bar: makeFolder("bar", "foo"),
        baz: makeFile("baz", "bar"),
      };
      ws.selectedNodeId = "preexisting-selection";
      ws.selectedFolderId = "preexisting-folder";
      ws.selectedNodeIds = ["preexisting-selection"];
      harness.seed(PROJECT_ID, ws);

      harness.setCurrentLocation(PROJECT_ID, "baz");

      const next = harness.getWorkspace(PROJECT_ID);
      assert.equal(next.selectedNodeId, "preexisting-selection");
      assert.equal(next.selectedFolderId, "preexisting-folder");
      assert.deepEqual(next.selectedNodeIds, ["preexisting-selection"]);
    });

    it("navigating to a folder expands that folder and its ancestors", () => {
      const ws = defaultWorkspace();
      ws.nodesById = {
        foo: makeFolder("foo", null),
        bar: makeFolder("bar", "foo"),
      };
      harness.seed(PROJECT_ID, ws);

      harness.setCurrentLocation(PROJECT_ID, "bar");

      const next = harness.getWorkspace(PROJECT_ID);
      assert.equal(next.currentLocationId, "bar");
      // The target folder's parent must be expanded so `bar` is visible.
      assert.equal(next.expandedFolderIds["foo"], true);
    });

    it("null resets currentLocationId to root without touching expandedFolderIds", () => {
      const ws = defaultWorkspace();
      ws.nodesById = {
        foo: makeFolder("foo", null),
        bar: makeFolder("bar", "foo"),
      };
      ws.currentLocationId = "bar";
      ws.expandedFolderIds = { foo: true };
      harness.seed(PROJECT_ID, ws);

      harness.setCurrentLocation(PROJECT_ID, null);

      const next = harness.getWorkspace(PROJECT_ID);
      assert.equal(next.currentLocationId, null);
      assert.equal(next.expandedFolderIds["foo"], true);
    });

    it("creates a fresh workspace entry when none exists", () => {
      // No `seed` call — the slice must fall back to `defaultWorkspace()`.
      harness.setCurrentLocation("brand-new-project", null);
      const ws = harness.getWorkspace("brand-new-project");
      assert.ok(ws, "workspace entry should be created on first write");
      assert.equal(ws.currentLocationId, null);
    });

    it("tolerates an unknown nodeId without throwing or mutating expansions", () => {
      const ws = defaultWorkspace();
      ws.nodesById = { foo: makeFolder("foo", null) };
      harness.seed(PROJECT_ID, ws);

      harness.setCurrentLocation(PROJECT_ID, "missing-node");

      const next = harness.getWorkspace(PROJECT_ID);
      // The id is recorded even when unresolved so deep-link error handling
      // can choose how to display the failure. Expansions remain untouched.
      assert.equal(next.currentLocationId, "missing-node");
      assert.equal(next.expandedFolderIds["foo"], undefined);
    });

    it("guards against cycles in the ancestor chain", () => {
      // Malformed cache: a -> b -> a. The action must terminate.
      const ws = defaultWorkspace();
      ws.nodesById = {
        a: makeFolder("a", "b"),
        b: makeFolder("b", "a"),
      };
      harness.seed(PROJECT_ID, ws);

      harness.setCurrentLocation(PROJECT_ID, "a");

      const next = harness.getWorkspace(PROJECT_ID);
      assert.equal(next.currentLocationId, "a");
      // The strict ancestor `b` is expanded; the walk halts when it sees
      // `a` again.
      assert.equal(next.expandedFolderIds["b"], true);
    });
  });
});
