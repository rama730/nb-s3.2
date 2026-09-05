import type { ProjectNode } from "@/lib/db/schema";

// ─── Explorer ────────────────────────────────────────────────────────
export type ExplorerSort = "name" | "updated" | "type";
export type ExplorerMode = "tree" | "search" | "favorites" | "recents" | "trash" | "sourceControl" | "outline";
export type FilesViewMode = "code" | "assets" | "all";
export type SavedExplorerView = {
  id: string;
  name: string;
  createdAt: number;
  config: {
    explorerMode: ExplorerMode;
    viewMode: FilesViewMode;
    sort: ExplorerSort;
    foldersFirst: boolean;
    selectedFolderId: string | null;
  };
};

// ─── Editor ──────────────────────────────────────────────────────────
export type EditorPreferences = {
  lineNumbers: boolean;
  wordWrap: boolean;
  fontSize: number;
  minimap: boolean;
  autosaveDelayMs: number;
  inactiveAutosaveConcurrency: number;
};

export enum SymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
}

export type EditorSymbol = {
  name: string;
  kind: SymbolKind;
  range: { startLineNumber: number; endLineNumber: number };
  children?: EditorSymbol[];
};

// ─── Workspace ───────────────────────────────────────────────────────
export type WorkspaceTab = {
  id: string; // nodeId
  pinned: boolean;
};

export type WorkspacePane = {
  id: "left" | "right";
  openTabIds: string[];
  activeTabId: string | null;
};

// ─── Collaboration ───────────────────────────────────────────────────
export type SoftLock = {
  projectId?: string;
  nodeId: string;
  lockedBy: string;
  lockedByName?: string | null;
  clientKind?: "web" | "vscode";
  acquiredAt?: number;
  renewedAt?: number;
  expiresAt: number;
};

export type NodeEventSummary = {
  type: string;
  at: number;
  by: string | null;
};

// ─── File cache ──────────────────────────────────────────────────────
export type FileState = {
  content: string;
  contentVersion: number;
  isDirty: boolean;
  lastSavedAt?: number;
  lastAccessedAt?: number;
};

// ─── Git ─────────────────────────────────────────────────────────────
export type GitState = {
  repoUrl: string | null;
  branch: string;
  lastSyncAt: string | null;
  lastCommitSha: string | null;
  syncInProgress: boolean;
  changedFiles: { nodeId: string; status: "modified" | "added" | "deleted" }[];
  commitMessage: string;
  branches: string[];
  gitStatusLoaded?: boolean;
  syncBadge?: {
    status: "idle" | "syncing" | "incoming" | "completed" | "failed";
    count?: number;
    tooltip?: string;
  } | null;
};

// ─── UI ──────────────────────────────────────────────────────────────
export type UiState = {
  bottomPanelTab: "run" | "output" | "problems";
  bottomPanelHeight: number;
  bottomPanelCollapsed: boolean;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  zenMode: boolean;
  searchReplaceOpen: boolean;
  commandPaletteOpen: boolean;
  quickOpenOpen: boolean;
  lastExecutionOutput: string[];
  /** When set, OutputTab shows "Open Languages" link; cleared on success or clear. */
  lastExecutionSettingsHref: string | null;
  /** Raw text for Python input(); one line per input() call. Parsed when Run is clicked. */
  stdinInputText: string;
  /** Linter and execution problems. */
  problems: Problem[];
  /** Run command history (max 50). */
  commandHistory: string[];
  /** Persisted output mode filter */
  outputFilterMode: "all" | "out" | "err";
  /** @internal Saved state for Zen mode restore */
  _prevBottomPanelCollapsed?: boolean;
};

export interface Problem {
  id: string;
  nodeId: string;
  filePath: string;
  line?: number;
  column?: number;
  severity: "error" | "warning" | "info";
  message: string;
  source?: "execution" | "linter";
  fix?: {
    label: string;
    action: "replace";
    targetString: string;
    replacement: string;
  };
}

// ─── Per-project workspace state ─────────────────────────────────────
export type ProjectWorkspaceState = {
  treeVersion: number;
  tabsVersion: number;
  selectionVersion: number;

  // Explorer
  explorerMode: ExplorerMode;
  viewMode: FilesViewMode;
  viewModeByExplorerMode: Partial<Record<ExplorerMode, FilesViewMode>>;
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  selectedFolderId: string | null;
  /**
   * The single navigation source of truth for the Files tab v3.
   * Coexists with `selectedNodeId` / `selectedFolderId`, which remain the
   * observable selection shape used by the Tasks tab (see Req 21.7).
   * `null` means "at project root folder".
   */
  currentLocationId: string | null;
  expandedFolderIds: Record<string, boolean>;
  searchQuery: string;
  sort: ExplorerSort;
  foldersFirst: boolean;
  favorites: Record<string, boolean>;
  recents: string[];
  savedViews: SavedExplorerView[];

  // Cached metadata
  nodesById: Record<string, ProjectNode>;
  childrenByParentId: Record<string, string[]>;
  loadedChildren: Record<string, boolean>;
  folderMeta: Record<string, { nextCursor: string | null; hasMore: boolean }>;
  taskLinkCounts: Record<string, number>;
  activeFileSymbols: EditorSymbol[];
  lastNodeEventsByNodeId: Record<string, NodeEventSummary | null>;

  // Workspace (tabs / split)
  splitEnabled: boolean;
  splitRatio: number;
  panes: Record<WorkspacePane["id"], WorkspacePane>;
  pinnedByTabId: Record<string, boolean>;

  // Editor prefs
  prefs: EditorPreferences;

  // Collaboration
  locksByNodeId: Record<string, SoftLock>;

  // In-memory file cache (not persisted)
  fileStates: Record<string, FileState>;
  signedUrls: Record<string, { url: string; expiresAt: number }>;

  // Transient UI state
  requestedScrollPosition: { nodeId: string; line: number } | null;
  /** Current text editor with unsaved changes. Transient and never persisted. */
  dirtyFileId: string | null;
  /** Destination awaiting confirmation while an editor has unsaved changes. */
  pendingNavigation: { nodeId: string | null; preserveQuery?: boolean } | null;

  // Git
  git: GitState;

  // UI
  ui: UiState;
};

// ─── Top-level store state ───────────────────────────────────────────
export type FilesWorkspaceState = {
  byProjectId: Record<string, ProjectWorkspaceState>;

  // getters
  _get: (projectId: string) => ProjectWorkspaceState;
  ensureProjectWorkspace: (projectId: string) => void;

  // explorer actions
  setExplorerMode: (projectId: string, mode: ExplorerMode) => void;
  setViewMode: (projectId: string, mode: FilesViewMode) => void;
  setSelectedNode: (projectId: string, nodeId: string | null, parentId?: string | null) => void;
  setSelectedNodeIds: (projectId: string, nodeIds: string[]) => void;
  toggleExpanded: (projectId: string, folderId: string, expanded?: boolean) => void;
  setSearchQuery: (projectId: string, query: string) => void;
  setSort: (projectId: string, sort: ExplorerSort) => void;
  setFoldersFirst: (projectId: string, foldersFirst: boolean) => void;
  addRecent: (projectId: string, nodeId: string) => void;
  toggleFavorite: (projectId: string, nodeId: string) => void;

  // cache actions
  upsertNodes: (projectId: string, nodes: ProjectNode[]) => void;
  setChildren: (projectId: string, parentId: string | null, childIds: string[]) => void;
  setFolderPayload: (
    projectId: string,
    parentId: string | null,
    payload: { childIds: string[]; nextCursor: string | null; hasMore: boolean; loaded: boolean }
  ) => void;
  setNodesAndChildren: (
    projectId: string,
    nodes: ProjectNode[],
    parentId: string | null,
    childIds: string[],
    payload?: { nextCursor: string | null; hasMore: boolean; loaded: boolean }
  ) => void;
  markChildrenLoaded: (projectId: string, parentId: string | null) => void;
  setFolderMeta: (projectId: string, folderId: string | null, meta: { nextCursor: string | null; hasMore: boolean }) => void;
  removeNodeFromCaches: (projectId: string, nodeId: string) => void;
  setTaskLinkCounts: (projectId: string, counts: Record<string, number>) => void;
  patchNodeVersion: (projectId: string, nodeId: string, currentVersion: number) => void;
  setNodes: (projectId: string, nodes: ProjectNode[]) => void;
  batchUpdateStore: (
    projectId: string,
    payloads: Array<{
      parentId: string | null;
      childIds: string[];
      nextCursor: string | null;
      hasMore: boolean;
      loaded: boolean;
    }>,
    nodes?: ProjectNode[]
  ) => void;
  hydrateFromIdb: (
    projectId: string,
    nodesById: Record<string, ProjectNode>,
    childrenByParentId: Record<string, string[]>
  ) => void;

  // file state actions

  // workspace actions

  /**
   * Files tab v3 navigation write path.
   *
   * Atomically (a) sets `currentLocationId`, (b) bumps `selectionVersion`,
   * and (c) ensures every ancestor of `nodeId` is in `expandedFolderIds`.
   *
   * Does NOT touch `selectedNodeId` / `selectedFolderId`, which remain the
   * Tasks tab's selection surface (Req 21.7).
   */
  setCurrentLocation: (projectId: string, nodeId: string | null) => void;
  setDirtyFile: (projectId: string, nodeId: string, dirty: boolean) => void;
  setPendingNavigation: (
    projectId: string,
    pending: { nodeId: string | null; preserveQuery?: boolean } | null,
  ) => void;

  // explorer cleanup
  /** FW9: Remove expandedFolderIds entries whose node no longer exists */
  pruneDeadExpanded: (projectId: string) => void;

  // editor prefs
  setPrefs: (projectId: string, prefs: Partial<EditorPreferences>) => void;

  // locks
  setLocks: (projectId: string, locks: SoftLock[]) => void;
  setLastNodeEventSummary: (projectId: string, nodeId: string, summary: NodeEventSummary) => void;
  clearLastNodeEventSummary: (projectId: string, nodeId: string) => void;

  // git actions
  setGitRepo: (projectId: string, repoUrl: string, branch: string) => void;
  setGitBranch: (projectId: string, branch: string) => void;
  setGitChangedFiles: (projectId: string, files: GitState["changedFiles"]) => void;
  setGitStatusLoaded: (projectId: string, loaded: boolean) => void;
  setGitSyncBadge: (projectId: string, badge: GitState["syncBadge"]) => void;

  // ui actions
  setQuickOpenOpen: (projectId: string, open: boolean) => void;
  toggleSidebar: (projectId: string) => void;
};

// ─── Defaults ────────────────────────────────────────────────────────
export const DEFAULT_PREFS: EditorPreferences = {
  lineNumbers: true,
  wordWrap: true,
  fontSize: 14,
  minimap: false,
  autosaveDelayMs: 2500,
  inactiveAutosaveConcurrency: 2,
};

export const DEFAULT_GIT_STATE: GitState = {
  repoUrl: null,
  branch: "main",
  lastSyncAt: null,
  lastCommitSha: null,
  syncInProgress: false,
  changedFiles: [],
  commitMessage: "",
  branches: [],
  gitStatusLoaded: false,
  syncBadge: null,
};

export const DEFAULT_UI_STATE: UiState = {
  bottomPanelTab: "run",
  bottomPanelHeight: 200,
  bottomPanelCollapsed: true,
  sidebarWidth: 290,
  sidebarCollapsed: false,
  zenMode: false,
  searchReplaceOpen: false,
  commandPaletteOpen: false,
  quickOpenOpen: false,
  lastExecutionOutput: [],
  lastExecutionSettingsHref: null,
  stdinInputText: "",
  problems: [],
  commandHistory: [],
  outputFilterMode: "all",
  _prevBottomPanelCollapsed: undefined,
};

export const ROOT_KEY = "__root__";
export const parentKey = (parentId: string | null) => parentId ?? ROOT_KEY;

export function defaultWorkspace(): ProjectWorkspaceState {
  return {
    treeVersion: 0,
    tabsVersion: 0,
    selectionVersion: 0,

    explorerMode: "tree",
    viewMode: "code",
    viewModeByExplorerMode: { tree: "code" },
    selectedNodeId: null,
    selectedNodeIds: [],
    selectedFolderId: null,
    currentLocationId: null,
    expandedFolderIds: {},
    searchQuery: "",
    sort: "name",
    foldersFirst: true,
    favorites: {},
    recents: [],
    savedViews: [],

    nodesById: {},
    childrenByParentId: {},
    loadedChildren: {},
    folderMeta: {},
    taskLinkCounts: {},
    lastNodeEventsByNodeId: {},

    splitEnabled: false,
    splitRatio: 0.5,
    panes: {
      left: { id: "left", openTabIds: [], activeTabId: null },
      right: { id: "right", openTabIds: [], activeTabId: null },
    },
    pinnedByTabId: {},

    prefs: DEFAULT_PREFS,
    locksByNodeId: {},

    fileStates: {},
    signedUrls: {},

    activeFileSymbols: [],
    requestedScrollPosition: null,
    dirtyFileId: null,
    pendingNavigation: null,

    git: { ...DEFAULT_GIT_STATE },
    ui: { ...DEFAULT_UI_STATE },
  };
}

export function symbolsEqual(a: EditorSymbol[], b: EditorSymbol[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (!left || !right) return false;
    if (
      left.name !== right.name ||
      left.kind !== right.kind ||
      left.range.startLineNumber !== right.range.startLineNumber ||
      left.range.endLineNumber !== right.range.endLineNumber
    ) {
      return false;
    }
    const leftChildren = left.children || [];
    const rightChildren = right.children || [];
    if (!symbolsEqual(leftChildren, rightChildren)) {
      return false;
    }
  }
  return true;
}

/**
 * React 19 + useSyncExternalStore requires selector results to be stable.
 * This fallback must be a stable reference — never mutate it.
 */
export const FALLBACK_WORKSPACE: ProjectWorkspaceState = Object.freeze(
  defaultWorkspace()
) as ProjectWorkspaceState;
