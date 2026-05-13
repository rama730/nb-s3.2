// Persist migration contract — Task 1.5 of the Files Tab GitHub Redesign.
//
// Requirement 15.19: the Files tab MUST ignore legacy persisted state for
// removed features on load.
// Requirement 21.7: the Tasks tab's observable store surface MUST remain
// intact (tested here via the public store API, not via schema extraction).
//
// Acceptance (tasks.md § 1.5):
//   (i)  A legacy `files-workspace-v2` blob with dropped keys is ignored on
//        mount — the workspace falls back to fresh defaults.
//   (ii) No dropped key is readable from the persisted blob — the partialize
//        contract drops every non-keep key so it is never re-read from
//        storage on a subsequent rehydrate.
//   (iii) `currentLocationId` round-trips through persist — a value written
//         through the public action is visible after a fresh rehydrate.
//
// See design.md § Migration Note.

// NOTE: We must install `globalThis.localStorage` before the store module is
// imported. `createJSONStorage(() => localStorage)` runs at persist-middleware
// creation time, which is during module import. Using a dynamic import after
// setup keeps the ordering explicit.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  installMemoryLocalStorage,
  type MemoryStorage,
} from "./_memoryStorage";

// ─── Helpers ─────────────────────────────────────────────────────────

const V2_KEY = "files-workspace-v2";
const V3_KEY = "files-workspace-v3";

/**
 * Build a representative legacy blob. Every dropped key listed in tasks.md §
 * 1.5 that was part of the previous persist shape is included so the test
 * catches accidental leakage.
 */
function buildLegacyV2Blob(projectId: string) {
  return {
    state: {
      byProjectId: {
        [projectId]: {
          // Dropped workspace/editor/pane state that the v2 shape persisted.
          splitEnabled: true,
          splitRatio: 0.71,
          panes: {
            left: { id: "left", openTabIds: ["leaked-tab-a"], activeTabId: "leaked-tab-a" },
            right: { id: "right", openTabIds: ["leaked-tab-b"], activeTabId: "leaked-tab-b" },
          },
          pinnedByTabId: { "leaked-tab-a": true },
          savedViews: [
            {
              id: "view-1",
              name: "leaked-view",
              createdAt: 1,
              config: {
                explorerMode: "tree",
                viewMode: "code",
                sort: "name",
                foldersFirst: true,
                selectedFolderId: null,
              },
            },
          ],
          viewModeByExplorerMode: { tree: "assets", search: "assets" },
          prefs: {
            lineNumbers: false,
            wordWrap: false,
            fontSize: 30,
            minimap: true,
            autosaveDelayMs: 9999,
            inactiveAutosaveConcurrency: 9,
          },
          // Keys that were never persisted but the task still listed.
          fileStates: { "leaked-file": { content: "x", contentVersion: 1, isDirty: true } },
          activeFileSymbols: [
            { name: "leaked-symbol", kind: 12, range: { startLineNumber: 1, endLineNumber: 2 } },
          ],
          requestedScrollPosition: { nodeId: "leaked-file", line: 42 },
          lastNodeEventsByNodeId: { "leaked-file": { type: "leaked", at: 1, by: null } },
          selectedNodeIds: ["leaked-a", "leaked-b"],
          git: {
            repoUrl: null,
            branch: "leaked-branch",
            lastSyncAt: "2020-01-01T00:00:00.000Z",
            lastCommitSha: "deadbeef",
            syncInProgress: true,
            changedFiles: [],
            commitMessage: "leaked commit message",
            branches: ["leaked-branch", "leaked-other"],
            gitStatusLoaded: true,
          },
          ui: {
            bottomPanelTab: "output",
            bottomPanelHeight: 999,
            bottomPanelCollapsed: false,
            _prevBottomPanelCollapsed: true,
            sidebarWidth: 999,
            sidebarCollapsed: true,
            zenMode: true,
            searchReplaceOpen: true,
            commandPaletteOpen: true,
            quickOpenOpen: true,
            lastExecutionOutput: ["leaked-line"],
            lastExecutionSettingsHref: "/leaked",
            stdinInputText: "leaked-stdin",
            problems: [
              { id: "leaked-p", nodeId: "x", filePath: "/x", severity: "error", message: "leaked" },
            ],
            commandHistory: ["leaked cmd"],
            outputFilterMode: "err",
          },
          // Still persisted under v3 — included so the test can verify the v2
          // blob's values for these keys are NOT applied (wrong key + wrong
          // name).
          expandedFolderIds: { "legacy-folder": true },
          favorites: { "legacy-fav": true },
          recents: ["legacy-recent"],
          sort: "updated",
          foldersFirst: false,
        },
      },
    },
    version: 0,
  };
}

async function importStore() {
  // Import is relative — path alias `@/` does not work under `node:test`.
  return import("../../../src/stores/files/index");
}

type StoreModule = Awaited<ReturnType<typeof importStore>>;
type Store = StoreModule["useFilesWorkspaceStore"];

function readPersisted(storage: MemoryStorage, key: string): { state: unknown; version: number } | null {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  return JSON.parse(raw) as { state: unknown; version: number };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("files workspace store — persist migration v2 → v3 (Task 1.5)", () => {
  // The store is a module-level singleton; install a fresh MemoryStorage
  // before the first import so `createJSONStorage(() => localStorage)`
  // captures it.
  const handle = installMemoryLocalStorage();

  it("uses `files-workspace-v3` as the persist key (v2 blob under v2 key is orphaned)", async () => {
    const projectId = "project-v3-key";
    handle.storage.clear();
    handle.storage.setItem(V2_KEY, JSON.stringify(buildLegacyV2Blob(projectId)));

    const { useFilesWorkspaceStore } = await importStore();
    const store = useFilesWorkspaceStore as unknown as Store & {
      persist: {
        rehydrate: () => Promise<void> | void;
        getOptions: () => { name?: string };
      };
    };
    // Persist rehydration is synchronous when storage is synchronous, but
    // zustand wraps it in a thenable — awaiting is safe in both cases.
    await store.persist.rehydrate();

    assert.equal(
      store.persist.getOptions().name,
      V3_KEY,
      "persist name must be bumped to files-workspace-v3",
    );
    // The v2 blob is orphaned and remains untouched at its original key.
    assert.notEqual(
      handle.storage.getItem(V2_KEY),
      null,
      "legacy v2 blob remains in storage (not read, not cleared)",
    );
  });

  it("ignores a legacy v2 blob on mount — workspace entry is NOT seeded from v2", async () => {
    const projectId = "project-legacy-ignored";
    handle.storage.clear();
    handle.storage.setItem(V2_KEY, JSON.stringify(buildLegacyV2Blob(projectId)));

    const { useFilesWorkspaceStore } = await importStore();
    const store = useFilesWorkspaceStore as unknown as Store & {
      persist: { rehydrate: () => Promise<void> | void };
      getState: () => { byProjectId: Record<string, unknown | undefined> };
    };
    await store.persist.rehydrate();

    // The legacy project is under the v2 key which v3 does not read → the
    // project's workspace entry is absent, not seeded with leaked values.
    assert.equal(
      store.getState().byProjectId[projectId],
      undefined,
      "no workspace entry is rehydrated from the legacy v2 blob",
    );
  });

  it("falls back to fresh defaults when the v3 key is present but empty-ish", async () => {
    const projectId = "project-fresh-defaults";
    handle.storage.clear();
    // A v3 blob that contains ONLY the byProjectId envelope — workspace
    // entry is an empty partial. `merge` must overlay it on a fresh
    // defaultWorkspace so every unspecified key uses the default.
    handle.storage.setItem(
      V3_KEY,
      JSON.stringify({ state: { byProjectId: { [projectId]: {} } }, version: 0 }),
    );

    const { useFilesWorkspaceStore, defaultWorkspace } = await importStore();
    const store = useFilesWorkspaceStore as unknown as Store & {
      persist: { rehydrate: () => Promise<void> | void };
      getState: () => {
        byProjectId: Record<string, Record<string, unknown> | undefined>;
      };
    };
    await store.persist.rehydrate();

    const ws = store.getState().byProjectId[projectId];
    assert.ok(ws, "workspace entry is created for the empty partial");

    const fresh = defaultWorkspace();
    // Every dropped key keeps its default value — nothing from v2 leaks
    // through (and there is nothing to leak since v2 uses a different
    // storage key).
    assert.equal(ws.splitEnabled, fresh.splitEnabled);
    assert.equal(ws.splitRatio, fresh.splitRatio);
    assert.deepEqual(ws.panes, fresh.panes);
    assert.deepEqual(ws.pinnedByTabId, fresh.pinnedByTabId);
    assert.deepEqual(ws.savedViews, fresh.savedViews);
    assert.deepEqual(ws.viewModeByExplorerMode, fresh.viewModeByExplorerMode);
    assert.deepEqual(ws.prefs, fresh.prefs);
    assert.deepEqual(ws.fileStates, fresh.fileStates);
    assert.deepEqual(ws.activeFileSymbols, fresh.activeFileSymbols);
    assert.equal(ws.requestedScrollPosition, fresh.requestedScrollPosition);
    assert.deepEqual(ws.lastNodeEventsByNodeId, fresh.lastNodeEventsByNodeId);
    assert.deepEqual(ws.selectedNodeIds, fresh.selectedNodeIds);
    assert.deepEqual(ws.git, fresh.git);
    // UI keeps every default except the two persisted ui keys — which are
    // also absent from this blob, so defaults apply here too.
    assert.deepEqual(ws.ui, fresh.ui);
  });

  it("partialize only persists the eight allowed keys (no dropped key is readable)", async () => {
    const projectId = "project-partialize";
    handle.storage.clear();

    const { useFilesWorkspaceStore } = await importStore();
    const store = useFilesWorkspaceStore as unknown as Store & {
      persist: { rehydrate: () => Promise<void> | void };
      getState: () => {
        ensureProjectWorkspace: (projectId: string) => void;
        setCurrentLocation: (projectId: string, nodeId: string | null) => void;
        toggleExpanded: (projectId: string, folderId: string, expanded?: boolean) => void;
        setSort: (projectId: string, sort: "name" | "updated" | "type") => void;
        setFoldersFirst: (projectId: string, value: boolean) => void;
        toggleFavorite: (projectId: string, nodeId: string) => void;
        addRecent: (projectId: string, nodeId: string) => void;
        toggleSidebar: (projectId: string) => void;
        setQuickOpenOpen: (projectId: string, open: boolean) => void;
        // Intentionally-dropped setters — we write through these to prove
        // their values are NOT persisted.
        setSplitEnabled: (projectId: string, enabled: boolean) => void;
        setPrefs: (projectId: string, prefs: { fontSize?: number }) => void;
        setBottomPanelTab: (projectId: string, tab: "run" | "output" | "problems") => void;
        setStdinInputText: (projectId: string, text: string) => void;
      };
    };

    // Hydrate first so the middleware has a clean slate, then write through
    // the public actions.
    await store.persist.rehydrate();
    const s = store.getState();
    s.ensureProjectWorkspace(projectId);
    s.setCurrentLocation(projectId, null);
    s.toggleExpanded(projectId, "folder-keep", true);
    s.setSort(projectId, "updated");
    s.setFoldersFirst(projectId, false);
    s.toggleFavorite(projectId, "fav-keep");
    s.addRecent(projectId, "recent-keep");
    s.toggleSidebar(projectId);
    s.setQuickOpenOpen(projectId, true);
    // Writes to keys that MUST NOT round-trip.
    s.setSplitEnabled(projectId, true);
    s.setPrefs(projectId, { fontSize: 42 });
    s.setBottomPanelTab(projectId, "problems");
    s.setStdinInputText(projectId, "should-not-persist");

    const persisted = readPersisted(handle.storage, V3_KEY);
    assert.ok(persisted, "v3 blob must be written to storage");
    const envelope = persisted.state as { byProjectId: Record<string, Record<string, unknown>> };
    const ws = envelope.byProjectId[projectId];
    assert.ok(ws, "project workspace must be persisted under v3");

    // The ONLY keys allowed at the workspace-entry level.
    const ALLOWED_KEYS = new Set([
      "currentLocationId",
      "expandedFolderIds",
      "favorites",
      "recents",
      "sort",
      "foldersFirst",
      "ui",
    ]);
    const persistedKeys = new Set(Object.keys(ws));
    for (const key of persistedKeys) {
      assert.ok(
        ALLOWED_KEYS.has(key),
        `unexpected persisted key "${key}" — must be one of ${[...ALLOWED_KEYS].join(", ")}`,
      );
    }

    // `ui` must only carry the two allowed sub-keys.
    const ui = ws.ui as Record<string, unknown>;
    const ALLOWED_UI_KEYS = new Set(["sidebarCollapsed", "quickOpenOpen"]);
    for (const key of Object.keys(ui)) {
      assert.ok(
        ALLOWED_UI_KEYS.has(key),
        `unexpected persisted ui key "${key}"`,
      );
    }

    // Positive assertions on the kept values.
    assert.equal(ws.sort, "updated");
    assert.equal(ws.foldersFirst, false);
    assert.deepEqual(ws.expandedFolderIds, { "folder-keep": true });
    assert.deepEqual(ws.favorites, { "fav-keep": true });
    assert.deepEqual(ws.recents, ["recent-keep"]);
    assert.equal(ui.sidebarCollapsed, true);
    assert.equal(ui.quickOpenOpen, true);
  });

  it("currentLocationId round-trips through persist across a fresh rehydrate", async () => {
    const projectId = "project-roundtrip";
    handle.storage.clear();

    const { useFilesWorkspaceStore } = await importStore();
    const store = useFilesWorkspaceStore as unknown as Store & {
      persist: { rehydrate: () => Promise<void> | void };
      setState: (
        partial: { byProjectId: Record<string, unknown> },
        replace?: boolean,
      ) => void;
      getState: () => {
        byProjectId: Record<string, { currentLocationId: string | null } | undefined>;
        setCurrentLocation: (projectId: string, nodeId: string | null) => void;
      };
    };

    await store.persist.rehydrate();
    store.getState().setCurrentLocation(projectId, "node-42");

    // The write path must have persisted the id under the v3 key.
    const persistedRaw = handle.storage.getItem(V3_KEY);
    assert.ok(persistedRaw, "v3 blob must be written to storage");
    const wsPersisted = (JSON.parse(persistedRaw) as {
      state: { byProjectId: Record<string, { currentLocationId: string | null }> };
    }).state.byProjectId[projectId];
    assert.equal(wsPersisted.currentLocationId, "node-42");

    // Simulate a fresh boot: clear the in-memory entry, then restore the
    // persisted blob (the setState write would otherwise overwrite it via
    // the persist middleware), then rehydrate.
    store.setState({ byProjectId: {} });
    handle.storage.setItem(V3_KEY, persistedRaw);
    await store.persist.rehydrate();

    const roundTripped = store.getState().byProjectId[projectId];
    assert.ok(roundTripped, "project workspace is restored from persisted v3 blob");
    assert.equal(roundTripped.currentLocationId, "node-42");
  });
});
