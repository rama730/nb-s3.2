// Task 3.1 — `V3AttachmentPicker` component.
//
// A unified file picker that reuses the V3 sidebar tree in navigate-only
// mode. Renders a left pane (tree), a right pane (search results or
// recent files), and a pinned tray at the bottom showing selected items
// as removable chips.
//
// Requirements: 6.1, 6.2, 6.3, 6.4, 6.7, 16.1, 17.3.
//
// MUST NOT import `FileExplorer` or `ExplorerShell`.

"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { X, Search, FileText, Clock } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import type { ProjectNode } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";

import {
  buildNodePathMap,
  rankFuzzyResults,
} from "../quick-open/QuickOpenDialog";
import { computeVisibleIdsForSearch } from "../sidebarSearch";

// ─── Constants ───────────────────────────────────────────────────────

const MAX_RECENTS = 20;
const MAX_RESULTS = 50;
const SEARCH_DEBOUNCE_MS = 200;

// ─── Public API ──────────────────────────────────────────────────────

export interface V3AttachmentPickerProps {
  projectId: string;
  projectName?: string;
  isOpen: boolean;
  onClose: () => void;
  initialSelection?: ProjectNode[];
  onSelectionChange?: (nodes: ProjectNode[]) => void;
}

// ─── Component ───────────────────────────────────────────────────────

export function V3AttachmentPicker({
  projectId,
  projectName,
  isOpen,
  onClose,
  initialSelection,
  onSelectionChange,
}: V3AttachmentPickerProps): React.JSX.Element | null {
  // ── Selection state ─────────────────────────────────────────────────
  const [selectedNodes, setSelectedNodes] = useState<ProjectNode[]>(
    () => initialSelection ?? [],
  );

  // Sync initial selection when it changes externally
  useEffect(() => {
    if (initialSelection) {
      setSelectedNodes(initialSelection);
    }
  }, [initialSelection]);

  // ── Search state ────────────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    if (searchInput.length === 0) {
      setDebouncedQuery("");
      return;
    }
    const timer = window.setTimeout(
      () => setDebouncedQuery(searchInput),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // ── Store selectors ─────────────────────────────────────────────────
  const { nodesById, recents, childrenByParentId, expandedFolderIds } =
    useFilesWorkspaceStore(
      useShallow((s) => {
        const ws = s.byProjectId[projectId];
        return {
          nodesById: ws?.nodesById ?? EMPTY_NODES,
          recents: ws?.recents ?? EMPTY_RECENTS,
          childrenByParentId: ws?.childrenByParentId ?? EMPTY_CHILDREN,
          expandedFolderIds: ws?.expandedFolderIds ?? EMPTY_EXPANDED,
        };
      }),
    );

  const toggleExpanded = useFilesWorkspaceStore((s) => s.toggleExpanded);

  // ── Telemetry: emit picker_opened on mount (Req 16.1) ──────────────
  const telemetryFiredRef = useRef(false);
  useEffect(() => {
    if (!isOpen) return;
    if (telemetryFiredRef.current) return;
    telemetryFiredRef.current = true;
    logger.metric("files_tab.picker_opened", {
      module: "files-tab",
      projectId,
    });
  }, [isOpen, projectId]);

  // Reset telemetry flag when picker closes so it fires again on next open
  useEffect(() => {
    if (!isOpen) {
      telemetryFiredRef.current = false;
    }
  }, [isOpen]);

  // ── Performance mark (Req 17.3) ────────────────────────────────────
  const perfMarkedRef = useRef(false);
  useEffect(() => {
    if (!isOpen) return;
    if (perfMarkedRef.current) return;
    if (typeof performance === "undefined") return;
    performance.mark("files-tab:picker-interactive");
    perfMarkedRef.current = true;
  }, [isOpen]);

  // ── Derived data ───────────────────────────────────────────────────
  const fileNodes = useMemo(
    () =>
      Object.values(nodesById).filter(
        (n): n is ProjectNode => !!n && n.type === "file",
      ),
    [nodesById],
  );

  const nodePathById = useMemo(
    () => buildNodePathMap(nodesById as Record<string, ProjectNode>),
    [nodesById],
  );

  const rawQuery = debouncedQuery.trim().toLowerCase();
  const showRecents = rawQuery.length === 0;

  // ── Right pane results ─────────────────────────────────────────────
  const results: ProjectNode[] = useMemo(() => {
    if (showRecents) {
      const seen = new Set<string>();
      const out: ProjectNode[] = [];
      for (const id of recents) {
        if (seen.has(id)) continue;
        seen.add(id);
        const node = (nodesById as Record<string, ProjectNode>)[id];
        if (node && node.type === "file") out.push(node);
        if (out.length >= MAX_RECENTS) break;
      }
      return out;
    }
    return rankFuzzyResults(
      fileNodes,
      nodePathById,
      rawQuery,
      MAX_RESULTS,
    );
  }, [showRecents, rawQuery, recents, nodesById, fileNodes, nodePathById]);

  // ── Tree filtering (navigate-only sidebar) ─────────────────────────
  const visibleIdsFromSearch = useMemo(
    () =>
      computeVisibleIdsForSearch(
        nodesById as Record<string, ProjectNode>,
        debouncedQuery,
      ),
    [nodesById, debouncedQuery],
  );

  // ── Selection helpers ──────────────────────────────────────────────
  const selectedNodeIds = useMemo(
    () => new Set(selectedNodes.map((n) => n.id)),
    [selectedNodes],
  );

  const toggleSelection = useCallback(
    (node: ProjectNode) => {
      setSelectedNodes((prev) => {
        const exists = prev.some((n) => n.id === node.id);
        const next = exists
          ? prev.filter((n) => n.id !== node.id)
          : [...prev, node];
        onSelectionChange?.(next);
        return next;
      });
    },
    [onSelectionChange],
  );

  const removeFromSelection = useCallback(
    (nodeId: string) => {
      setSelectedNodes((prev) => {
        const next = prev.filter((n) => n.id !== nodeId);
        onSelectionChange?.(next);
        return next;
      });
    },
    [onSelectionChange],
  );

  // ── Tree node click (navigate-only: expand folders, select files) ──
  const handleTreeNodeClick = useCallback(
    (node: ProjectNode) => {
      if (node.type === "folder") {
        toggleExpanded(projectId, node.id);
      } else {
        toggleSelection(node);
      }
    },
    [projectId, toggleExpanded, toggleSelection],
  );

  // ── Keyboard: Escape closes ────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  // ── Render gate ────────────────────────────────────────────────────
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Attachment picker"
      data-testid="v3-attachment-picker"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-4xl h-[70vh] rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl flex flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {projectName ? `Attach files — ${projectName}` : "Attach files"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close picker"
            data-testid="v3-attachment-picker-close"
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body: left tree + right pane */}
        <div className="flex-1 min-h-0 flex">
          {/* Left pane: navigate-only tree */}
          <div className="w-64 shrink-0 border-r border-zinc-200 dark:border-zinc-800 flex flex-col overflow-hidden">
            <div className="flex-1 min-h-0 overflow-auto">
              <PickerTree
                nodesById={nodesById as Record<string, ProjectNode>}
                childrenByParentId={
                  childrenByParentId as Record<string, string[]>
                }
                expandedFolderIds={
                  expandedFolderIds as Record<string, boolean>
                }
                visibleIds={visibleIdsFromSearch}
                selectedNodeIds={selectedNodeIds}
                onNodeClick={handleTreeNodeClick}
              />
            </div>
          </div>

          {/* Right pane: search results or recents */}
          <div className="flex-1 min-w-0 flex flex-col">
            {/* Search input */}
            <div className="shrink-0 px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search files..."
                  aria-label="Search files"
                  data-testid="v3-attachment-picker-search"
                  className="w-full h-8 pl-8 pr-3 text-sm bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-md text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-300"
                />
              </div>
            </div>

            {/* Results list */}
            <div
              className="flex-1 min-h-0 overflow-auto"
              data-testid="v3-attachment-picker-results"
            >
              {showRecents && results.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-zinc-500">
                  <Clock className="w-5 h-5 mx-auto mb-2 text-zinc-400" />
                  No recent files
                </div>
              ) : !showRecents && results.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-zinc-500">
                  <Search className="w-5 h-5 mx-auto mb-2 text-zinc-400" />
                  No matching files
                </div>
              ) : (
                <>
                  <div className="px-3 py-1.5 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    {showRecents ? "Recent files" : "Search results"}
                  </div>
                  {results.map((node) => {
                    const isSelected = selectedNodeIds.has(node.id);
                    const fullPath =
                      nodePathById.get(node.id) || node.name;
                    return (
                      <button
                        key={node.id}
                        type="button"
                        data-testid={`v3-attachment-picker-result-${node.id}`}
                        onClick={() => toggleSelection(node)}
                        className={`w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors ${
                          isSelected
                            ? "bg-indigo-50 dark:bg-indigo-950/30"
                            : ""
                        }`}
                      >
                        <FileText className="w-4 h-4 shrink-0 text-zinc-400" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                            {node.name}
                          </div>
                          <div className="text-xs text-zinc-500 truncate">
                            {fullPath}
                          </div>
                        </div>
                        {isSelected && (
                          <div className="shrink-0 w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center">
                            <svg
                              className="w-3 h-3 text-white"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={3}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Pinned tray: selected items as removable chips (Req 6.3, 6.4) */}
        <div
          className="shrink-0 border-t border-zinc-200 dark:border-zinc-800 px-4 py-2 min-h-[48px]"
          data-testid="v3-attachment-picker-tray"
        >
          {selectedNodes.length === 0 ? (
            <p className="text-xs text-zinc-400 py-1">
              No files selected
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {selectedNodes.map((node) => (
                <span
                  key={node.id}
                  data-testid={`v3-attachment-picker-chip-${node.id}`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200"
                >
                  <FileText className="w-3 h-3" />
                  <span className="max-w-[120px] truncate">{node.name}</span>
                  <button
                    type="button"
                    onClick={() => removeFromSelection(node.id)}
                    aria-label={`Remove ${node.name}`}
                    data-testid={`v3-attachment-picker-chip-remove-${node.id}`}
                    className="ml-0.5 p-0.5 rounded-full hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── PickerTree (navigate-only tree) ─────────────────────────────────

interface PickerTreeProps {
  nodesById: Record<string, ProjectNode>;
  childrenByParentId: Record<string, string[]>;
  expandedFolderIds: Record<string, boolean>;
  visibleIds: Set<string> | null;
  selectedNodeIds: Set<string>;
  onNodeClick: (node: ProjectNode) => void;
}

function PickerTree({
  nodesById,
  childrenByParentId,
  expandedFolderIds,
  visibleIds,
  selectedNodeIds,
  onNodeClick,
}: PickerTreeProps): React.JSX.Element {
  // Build a flat list of visible tree rows
  const rows = useMemo(() => {
    const result: Array<{ node: ProjectNode; level: number }> = [];

    function walk(parentId: string | null, level: number) {
      const key = parentId ?? "__root__";
      const childIds = childrenByParentId[key];
      if (!childIds) return;

      // Sort: folders first, then alphabetical
      const sorted = [...childIds].sort((a, b) => {
        const nodeA = nodesById[a];
        const nodeB = nodesById[b];
        if (!nodeA || !nodeB) return 0;
        if (nodeA.type === "folder" && nodeB.type !== "folder") return -1;
        if (nodeA.type !== "folder" && nodeB.type === "folder") return 1;
        return nodeA.name.localeCompare(nodeB.name);
      });

      for (const childId of sorted) {
        const node = nodesById[childId];
        if (!node) continue;
        // If search filter is active, skip nodes not in the visible set
        if (visibleIds && !visibleIds.has(node.id)) continue;

        result.push({ node, level });

        if (node.type === "folder" && expandedFolderIds[node.id]) {
          walk(node.id, level + 1);
        }
      }
    }

    walk(null, 0);
    return result;
  }, [nodesById, childrenByParentId, expandedFolderIds, visibleIds]);

  if (rows.length === 0) {
    return (
      <div className="px-3 py-4 text-xs text-zinc-500 text-center">
        No files available
      </div>
    );
  }

  return (
    <div role="tree" aria-label="File tree" className="py-1">
      {rows.map(({ node, level }) => {
        const isFolder = node.type === "folder";
        const isExpanded = isFolder && expandedFolderIds[node.id];
        const isSelected = selectedNodeIds.has(node.id);

        return (
          <button
            key={node.id}
            type="button"
            role="treeitem"
            aria-expanded={isFolder ? isExpanded : undefined}
            aria-selected={isSelected}
            data-testid={`v3-picker-tree-node-${node.id}`}
            onClick={() => onNodeClick(node)}
            className={`w-full text-left flex items-center gap-1 px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors ${
              isSelected
                ? "bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300"
                : "text-zinc-700 dark:text-zinc-300"
            }`}
            style={{ paddingLeft: `${8 + level * 16}px` }}
          >
            {isFolder ? (
              <span className="shrink-0 w-4 h-4 flex items-center justify-center text-zinc-400">
                {isExpanded ? "▾" : "▸"}
              </span>
            ) : (
              <FileText className="shrink-0 w-3.5 h-3.5 text-zinc-400" />
            )}
            <span className="truncate">{node.name}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Stable empty values ─────────────────────────────────────────────

const EMPTY_NODES: Record<string, ProjectNode> = Object.freeze(
  {},
) as Record<string, ProjectNode>;
const EMPTY_RECENTS: readonly string[] = Object.freeze(
  [],
) as readonly string[];
const EMPTY_CHILDREN: Record<string, string[]> = Object.freeze(
  {},
) as Record<string, string[]>;
const EMPTY_EXPANDED: Record<string, boolean> = Object.freeze(
  {},
) as Record<string, boolean>;

export default V3AttachmentPicker;
