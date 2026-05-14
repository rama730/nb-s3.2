// Task 13.5 — Property 5: TaskLinkCounts Realtime Convergence
//
// **Validates: Requirements 3.4**
//
// Invariant (design.md § Correctness Properties / Property 5):
//   After applying an arbitrary sequence of link/unlink mutations and
//   processing the corresponding realtime events, the store's
//   `taskLinkCounts[nodeId]` equals the count that the server would
//   return via `getTaskLinkCounts(projectId, [nodeId])`.
//
//   Formally: `eventually(store.taskLinkCounts[nodeId] == server.getTaskLinkCounts(nodeId))`
//
// Approach:
//   We simulate the realtime convergence flow without network calls:
//   1. Generate an arbitrary sequence of link/unlink mutations for a set of nodes.
//   2. Compute the "server truth" — the final count for each node after
//      applying all mutations sequentially.
//   3. Simulate the realtime handler: for each mutation, the handler
//      re-fetches the authoritative count from the server and calls
//      `setTaskLinkCounts` on the store.
//   4. Assert that the store's `taskLinkCounts` matches the server truth
//      for every affected node.
//
// This validates eventual consistency: regardless of the order or
// interleaving of link/unlink operations, the store converges to the
// server's authoritative state once all realtime events are processed.
//
// Uses `fc.assert(..., { numRuns: 100 })` per design § Correctness Properties.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { defaultWorkspace } from "@/stores/files/types";

// ─── Constants ───────────────────────────────────────────────────────

const PROJECT_ID = "proj-convergence";

// ─── Store helpers ───────────────────────────────────────────────────

function seedWorkspace() {
  const ws = {
    ...defaultWorkspace(),
    nodesById: {},
    childrenByParentId: {},
    treeVersion: 0,
  };
  useFilesWorkspaceStore.setState((state) => ({
    byProjectId: { ...state.byProjectId, [PROJECT_ID]: ws },
  }));
}

function getTaskLinkCounts(): Record<string, number> {
  return useFilesWorkspaceStore.getState().byProjectId[PROJECT_ID]!.taskLinkCounts;
}

// ─── Mutation types ──────────────────────────────────────────────────

interface LinkMutation {
  type: "link";
  nodeId: string;
  taskId: string;
}

interface UnlinkMutation {
  type: "unlink";
  nodeId: string;
  taskId: string;
}

type Mutation = LinkMutation | UnlinkMutation;

// ─── Server simulation ───────────────────────────────────────────────

/**
 * Simulates the server-side state of task_node_links. Tracks which
 * (nodeId, taskId) pairs exist. Provides a `getCount(nodeId)` method
 * that mirrors what `getTaskLinkCounts` would return.
 */
class ServerState {
  private links = new Map<string, Set<string>>(); // nodeId → Set<taskId>

  applyMutation(mutation: Mutation): void {
    if (mutation.type === "link") {
      const existing = this.links.get(mutation.nodeId) ?? new Set();
      existing.add(mutation.taskId);
      this.links.set(mutation.nodeId, existing);
    } else {
      const existing = this.links.get(mutation.nodeId);
      if (existing) {
        existing.delete(mutation.taskId);
        if (existing.size === 0) {
          this.links.delete(mutation.nodeId);
        }
      }
    }
  }

  getCount(nodeId: string): number {
    return this.links.get(nodeId)?.size ?? 0;
  }

  getAllCounts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [nodeId, tasks] of this.links) {
      out[nodeId] = tasks.size;
    }
    return out;
  }

  getAffectedNodeIds(): string[] {
    return [...this.links.keys()];
  }
}

// ─── Generators ──────────────────────────────────────────────────────

/** Generate a pool of node IDs (1..5 nodes). */
const nodeIdsArb = fc.array(
  fc.string({ minLength: 4, maxLength: 8 }).map((s) => `node-${s}`),
  { minLength: 1, maxLength: 5 },
).map((ids) => [...new Set(ids)]).filter((ids) => ids.length > 0);

/** Generate a pool of task IDs (1..8 tasks). */
const taskIdsArb = fc.array(
  fc.string({ minLength: 4, maxLength: 8 }).map((s) => `task-${s}`),
  { minLength: 1, maxLength: 8 },
).map((ids) => [...new Set(ids)]).filter((ids) => ids.length > 0);

/** Generate a sequence of link/unlink mutations over the given pools. */
function mutationSequenceArb(
  nodeIds: string[],
  taskIds: string[],
): fc.Arbitrary<Mutation[]> {
  const mutationArb: fc.Arbitrary<Mutation> = fc.oneof(
    fc.record({
      type: fc.constant("link" as const),
      nodeId: fc.constantFrom(...nodeIds),
      taskId: fc.constantFrom(...taskIds),
    }),
    fc.record({
      type: fc.constant("unlink" as const),
      nodeId: fc.constantFrom(...nodeIds),
      taskId: fc.constantFrom(...taskIds),
    }),
  );
  return fc.array(mutationArb, { minLength: 1, maxLength: 30 });
}

// ─── Reset ───────────────────────────────────────────────────────────

beforeEach(() => {
  useFilesWorkspaceStore.setState({ byProjectId: {} });
});

// ─── Property 5 — TaskLinkCounts Realtime Convergence ────────────────

describe("Property 5 — TaskLinkCounts Realtime Convergence", () => {
  it("store.taskLinkCounts converges to server counts after processing all realtime events", () => {
    fc.assert(
      fc.property(
        nodeIdsArb.chain((nodeIds) =>
          taskIdsArb.chain((taskIds) =>
            mutationSequenceArb(nodeIds, taskIds).map((mutations) => ({
              nodeIds,
              taskIds,
              mutations,
            })),
          ),
        ),
        ({ nodeIds, mutations }) => {
          // Reset store for each property run
          useFilesWorkspaceStore.setState({ byProjectId: {} });
          seedWorkspace();

          // 1. Build server state by applying all mutations
          const server = new ServerState();
          for (const mutation of mutations) {
            server.applyMutation(mutation);
          }

          // 2. Simulate the realtime convergence flow:
          //    For each mutation, the realtime handler re-fetches the
          //    authoritative count from the server and calls
          //    `setTaskLinkCounts`. Since we process all events, the
          //    store should converge to the server's final state.
          //
          //    In the real system, each realtime event triggers a
          //    re-fetch of the count for the affected node. We simulate
          //    this by applying mutations one at a time and updating
          //    the store after each one (mimicking the handler).
          const intermediateServer = new ServerState();
          const setTaskLinkCounts = useFilesWorkspaceStore.getState().setTaskLinkCounts;

          for (const mutation of mutations) {
            intermediateServer.applyMutation(mutation);

            // Simulate the realtime handler: re-fetch count for the
            // affected node and update the store
            const count = intermediateServer.getCount(mutation.nodeId);
            setTaskLinkCounts(PROJECT_ID, { [mutation.nodeId]: count });
          }

          // 3. Assert convergence: store counts match server counts
          //    for ALL affected nodes
          const storeCounts = getTaskLinkCounts();

          // Check every node that was involved in any mutation
          const allAffectedNodes = new Set(mutations.map((m) => m.nodeId));
          for (const nodeId of allAffectedNodes) {
            const serverCount = server.getCount(nodeId);
            const storeCount = storeCounts[nodeId] ?? 0;

            assert.equal(
              storeCount,
              serverCount,
              `store.taskLinkCounts["${nodeId}"] = ${storeCount}, ` +
              `but server.getCount("${nodeId}") = ${serverCount} ` +
              `(after ${mutations.length} mutations)`,
            );
          }

          // 4. Verify that the intermediate server and final server
          //    agree (sanity check on our simulation)
          for (const nodeId of allAffectedNodes) {
            assert.equal(
              intermediateServer.getCount(nodeId),
              server.getCount(nodeId),
              `intermediate and final server must agree for "${nodeId}"`,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("store converges to zero when all links are removed", () => {
    fc.assert(
      fc.property(
        nodeIdsArb.chain((nodeIds) =>
          taskIdsArb.map((taskIds) => ({ nodeIds, taskIds })),
        ),
        ({ nodeIds, taskIds }) => {
          // Reset store
          useFilesWorkspaceStore.setState({ byProjectId: {} });
          seedWorkspace();

          const setTaskLinkCounts = useFilesWorkspaceStore.getState().setTaskLinkCounts;
          const server = new ServerState();

          // First, link all combinations
          for (const nodeId of nodeIds) {
            for (const taskId of taskIds) {
              const mutation: LinkMutation = { type: "link", nodeId, taskId };
              server.applyMutation(mutation);
              const count = server.getCount(nodeId);
              setTaskLinkCounts(PROJECT_ID, { [nodeId]: count });
            }
          }

          // Then, unlink all combinations
          for (const nodeId of nodeIds) {
            for (const taskId of taskIds) {
              const mutation: UnlinkMutation = { type: "unlink", nodeId, taskId };
              server.applyMutation(mutation);
              const count = server.getCount(nodeId);
              setTaskLinkCounts(PROJECT_ID, { [nodeId]: count });
            }
          }

          // After unlinking everything, all counts should be zero
          const storeCounts = getTaskLinkCounts();
          for (const nodeId of nodeIds) {
            const storeCount = storeCounts[nodeId] ?? 0;
            assert.equal(
              storeCount,
              0,
              `store.taskLinkCounts["${nodeId}"] should be 0 after full unlink, got ${storeCount}`,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
