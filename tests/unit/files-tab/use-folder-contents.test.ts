// Unit tests for `useFolderContents` — Task 2.6 of the Files Tab GitHub
// Redesign spec.
//
// Acceptance (tasks.md § 2.6):
//   Unit test covering all three statuses + retry side effect.
//
// Requirements exercised: Req 4.1 (one row per child), Req 4.9 (loading
// header + spinner), Req 4.10 (inline error + retry affordance).
//
// The hook itself is tested via its two pure helpers — `deriveFolderContents`
// and `runFolderLoad` — which together cover the full state machine that the
// React wrapper delegates to. Targeting the pure helpers keeps the suite
// hermetic: no React renderer is wired up for node:test in this repo, and
// the wrapper contains no logic beyond (a) wiring zustand selectors, (b)
// reading the boot context, and (c) plumbing refs into `runFolderLoad`. The
// helpers are the public seam used by the React wrapper, so covering them
// covers the hook's observable behavior.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { ProjectNode } from "../../../src/lib/db/schema";
import {
  deriveFolderContents,
  runFolderLoad,
  type DeriveFolderContentsInput,
  type LoadFolderContent,
} from "../../../src/components/projects/v2/files-tab/hooks/useFolderContents";

// ─── Fixtures ────────────────────────────────────────────────────────

function makeNode(id: string, parentId: string | null): ProjectNode {
  return {
    id,
    projectId: "project-1",
    parentId,
    path: "/",
    type: "file",
    name: id,
    s3Key: `s3/${id}`,
    size: 10,
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

const NOOP = () => {};

function baseSnapshot(
  overrides: Partial<DeriveFolderContentsInput> = {},
): DeriveFolderContentsInput {
  return {
    loaded: false,
    childIds: [],
    nodesById: {},
    hasError: false,
    retry: NOOP,
    ...overrides,
  };
}

// ─── deriveFolderContents — status matrix ────────────────────────────

describe("useFolderContents / deriveFolderContents — status matrix (Req 4.1, 4.9, 4.10)", () => {
  describe("loading", () => {
    it("returns loading when loaded === undefined", () => {
      const result = deriveFolderContents(baseSnapshot({ loaded: undefined }));
      assert.equal(result.status, "loading");
      assert.deepEqual(result.children, []);
    });

    it("returns loading when loaded === false", () => {
      const result = deriveFolderContents(baseSnapshot({ loaded: false }));
      assert.equal(result.status, "loading");
      assert.deepEqual(result.children, []);
    });

    it("returns loading even if cached children exist but loaded is false (refresh in flight)", () => {
      // A prior session may have hydrated `childrenByParentId` from IDB,
      // but until the current-session refresh completes the list is still
      // considered stale. Keeps Req 4.9 predictable.
      const result = deriveFolderContents(
        baseSnapshot({
          loaded: false,
          childIds: ["a"],
          nodesById: { a: makeNode("a", "folder-1") },
        }),
      );
      assert.equal(result.status, "loading");
      assert.deepEqual(result.children, []);
    });
  });

  describe("ready", () => {
    it("returns ready with an empty list when the folder is loaded but has no children (Req 1.4)", () => {
      const result = deriveFolderContents(baseSnapshot({ loaded: true }));
      assert.equal(result.status, "ready");
      assert.deepEqual(result.children, []);
    });

    it("returns ready with the child ProjectNodes in the given childIds order", () => {
      const a = makeNode("a", "folder-1");
      const b = makeNode("b", "folder-1");
      const c = makeNode("c", "folder-1");
      const result = deriveFolderContents(
        baseSnapshot({
          loaded: true,
          childIds: ["b", "a", "c"],
          nodesById: { a, b, c },
        }),
      );
      assert.equal(result.status, "ready");
      // Hook preserves the given order verbatim; sorting is the folder-list
      // view's responsibility (Req 4.2).
      assert.deepEqual(result.children.map((n) => n.id), ["b", "a", "c"]);
    });

    it("silently filters out child ids that are not present in nodesById", () => {
      // `enforceNodesBudget` can evict a node without pruning every
      // `childrenByParentId` entry. The hook must tolerate the orphan
      // instead of crashing.
      const a = makeNode("a", "folder-1");
      const result = deriveFolderContents(
        baseSnapshot({
          loaded: true,
          childIds: ["a", "missing"],
          nodesById: { a },
        }),
      );
      assert.equal(result.status, "ready");
      assert.deepEqual(result.children.map((n) => n.id), ["a"]);
    });
  });

  describe("error", () => {
    it("returns error when hasError is true (Req 4.10)", () => {
      const result = deriveFolderContents(
        baseSnapshot({ loaded: true, hasError: true }),
      );
      assert.equal(result.status, "error");
      assert.deepEqual(result.children, []);
    });

    it("prioritizes error over loaded cached children so the Retry affordance is always reachable (Req 4.10)", () => {
      const a = makeNode("a", "folder-1");
      const result = deriveFolderContents(
        baseSnapshot({
          loaded: true,
          hasError: true,
          childIds: ["a"],
          nodesById: { a },
        }),
      );
      assert.equal(result.status, "error");
      // Children intentionally suppressed in the error branch so the view
      // does not render a mix of a stale list + error indicator.
      assert.deepEqual(result.children, []);
    });

    it("prioritizes error over loading (error dominates the status lattice)", () => {
      const result = deriveFolderContents(
        baseSnapshot({ loaded: false, hasError: true }),
      );
      assert.equal(result.status, "error");
    });
  });

  describe("retry passthrough", () => {
    it("exposes the retry callback verbatim on every status", () => {
      const retry = () => {};
      for (const variant of [
        baseSnapshot({ retry }),
        baseSnapshot({ retry, loaded: true }),
        baseSnapshot({ retry, hasError: true }),
      ]) {
        const result = deriveFolderContents(variant);
        assert.equal(result.retry, retry);
      }
    });
  });
});

// ─── runFolderLoad — retry side effect ───────────────────────────────

describe("useFolderContents / runFolderLoad — retry side effect (Req 4.10)", () => {
  it("invokes the loader with the given folderId in refresh mode", async () => {
    const calls: Array<[string | null, "refresh" | "append"]> = [];
    const load: LoadFolderContent = async (parentId, mode) => {
      calls.push([parentId, mode]);
    };

    await runFolderLoad({
      load,
      folderId: "folder-abc",
      onBeforeLoad: null,
      onError: () => {
        throw new Error("onError must not fire on success");
      },
      isStillCurrent: () => true,
    });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ["folder-abc", "refresh"]);
  });

  it("invokes the loader with null folderId for the project root", async () => {
    const calls: Array<[string | null, "refresh" | "append"]> = [];
    const load: LoadFolderContent = async (parentId, mode) => {
      calls.push([parentId, mode]);
    };

    await runFolderLoad({
      load,
      folderId: null,
      onBeforeLoad: null,
      onError: () => {
        throw new Error("onError must not fire on success");
      },
      isStillCurrent: () => true,
    });

    assert.deepEqual(calls[0], [null, "refresh"]);
  });

  it("fires onBeforeLoad exactly once, before the loader runs", async () => {
    const order: string[] = [];
    const load: LoadFolderContent = async () => {
      order.push("load");
    };

    await runFolderLoad({
      load,
      folderId: "x",
      onBeforeLoad: () => order.push("before"),
      onError: () => {
        throw new Error("onError must not fire on success");
      },
      isStillCurrent: () => true,
    });

    assert.deepEqual(order, ["before", "load"]);
  });

  it("does not fire onError when the loader resolves", async () => {
    let errored = false;
    const load: LoadFolderContent = async () => {};

    await runFolderLoad({
      load,
      folderId: "x",
      onBeforeLoad: null,
      onError: () => {
        errored = true;
      },
      isStillCurrent: () => true,
    });

    assert.equal(errored, false);
  });

  it("fires onError when the loader rejects and the request is still current", async () => {
    let errored = false;
    const load: LoadFolderContent = async () => {
      throw new Error("network");
    };

    await runFolderLoad({
      load,
      folderId: "x",
      onBeforeLoad: null,
      onError: () => {
        errored = true;
      },
      isStillCurrent: () => true,
    });

    assert.equal(errored, true);
  });

  it("suppresses onError when the folder changed while the load was in flight (stale-request guard)", async () => {
    let errored = false;
    const load: LoadFolderContent = async () => {
      throw new Error("network");
    };

    await runFolderLoad({
      load,
      folderId: "x",
      onBeforeLoad: null,
      onError: () => {
        errored = true;
      },
      // Simulate: by the time the rejection bubbles, the user has
      // navigated away and this invocation is no longer the current one.
      isStillCurrent: () => false,
    });

    assert.equal(
      errored,
      false,
      "stale request must not overwrite a newer folder's error state",
    );
  });

  it("retry restores ready after a transient failure: repeated calls use the fresh loader state", async () => {
    // The public surface of the hook exposes `retry` as a callback. A
    // consumer that clicks Retry in the error state invokes it exactly
    // once. Here we simulate the full fail-then-succeed cycle using two
    // sequential `runFolderLoad` calls on the same loader instance.
    let attempt = 0;
    const load: LoadFolderContent = async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("transient");
    };
    const events: string[] = [];

    await runFolderLoad({
      load,
      folderId: "x",
      onBeforeLoad: () => events.push("before-1"),
      onError: () => events.push("error"),
      isStillCurrent: () => true,
    });

    await runFolderLoad({
      load,
      folderId: "x",
      onBeforeLoad: () => events.push("before-2"),
      onError: () => events.push("error"),
      isStillCurrent: () => true,
    });

    assert.equal(attempt, 2, "retry must re-invoke the loader");
    assert.deepEqual(events, ["before-1", "error", "before-2"]);
  });

  it("tolerates a null onBeforeLoad without throwing", async () => {
    const load: LoadFolderContent = async () => {};
    await assert.doesNotReject(() =>
      runFolderLoad({
        load,
        folderId: "x",
        onBeforeLoad: null,
        onError: NOOP,
        isStillCurrent: () => true,
      }),
    );
  });
});
