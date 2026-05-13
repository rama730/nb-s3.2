// Task 2.2 acceptance test — `useCurrentLocation(projectId)` selector.
//
// Covers all three CurrentLocation branches plus the "store uninitialized"
// null return per tasks.md § 2.2 and design.md § Supporting Hooks.
//
// Requirements: Req 1.2, Req 1.3, Req 1.5, Req 6.1.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { ProjectNode } from "@/lib/db/schema";
import {
  defaultWorkspace,
  type ProjectWorkspaceState,
} from "@/stores/files/types";
import { selectCurrentLocation } from "@/components/projects/v2/files-tab/hooks/useCurrentLocation";

// ─── Fixture builders ────────────────────────────────────────────────

function makeFolder(id: string, parentId: string | null): ProjectNode {
  return {
    id,
    projectId: "proj-1",
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
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    deletedAt: null,
  } as unknown as ProjectNode;
}

function makeFile(id: string, parentId: string | null): ProjectNode {
  return {
    id,
    projectId: "proj-1",
    parentId,
    path: "/",
    type: "file",
    name: `${id}.txt`,
    s3Key: `s3/${id}`,
    size: 42,
    mimeType: "text/plain",
    currentVersion: 1,
    metadata: {},
    gitHash: null,
    createdBy: null,
    deletedBy: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    deletedAt: null,
  } as unknown as ProjectNode;
}

function seedWorkspace(overrides: Partial<ProjectWorkspaceState> = {}): ProjectWorkspaceState {
  return { ...defaultWorkspace(), ...overrides };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("useCurrentLocation selector (Task 2.2)", () => {
  it("returns null when the store has no workspace entry for the project (uninitialized)", () => {
    assert.equal(selectCurrentLocation(undefined), null);
  });

  it("returns { type: 'root' } when currentLocationId is null", () => {
    const ws = seedWorkspace({ currentLocationId: null });
    assert.deepEqual(selectCurrentLocation(ws), { type: "root" });
  });

  it("returns { type: 'folder', id, node } when currentLocationId resolves to a folder", () => {
    const folder = makeFolder("src", null);
    const ws = seedWorkspace({
      currentLocationId: "src",
      nodesById: { src: folder },
    });
    const result = selectCurrentLocation(ws);
    assert.deepEqual(result, { type: "folder", id: "src", node: folder });
  });

  it("returns { type: 'file', id, node } when currentLocationId resolves to a file", () => {
    const file = makeFile("button", "src");
    const ws = seedWorkspace({
      currentLocationId: "button",
      nodesById: {
        src: makeFolder("src", null),
        button: file,
      },
    });
    const result = selectCurrentLocation(ws);
    assert.deepEqual(result, { type: "file", id: "button", node: file });
  });

  it("falls back to { type: 'root' } when currentLocationId is set but the node is missing (transient race)", () => {
    // Deep-link arrival race: the id has been written but the node cache
    // has not yet been populated. The selector returns the root view so
    // the main area stays rendered; Req 6.6 / Req 10.5 error surfaces are
    // owned by the caller, not the selector.
    const ws = seedWorkspace({ currentLocationId: "not-yet-loaded" });
    assert.deepEqual(selectCurrentLocation(ws), { type: "root" });
  });
});
