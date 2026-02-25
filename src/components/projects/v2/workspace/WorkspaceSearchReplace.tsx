"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, X } from "lucide-react";
import { useToast } from "@/components/ui-custom/Toast";
import type { ProjectNode } from "@/lib/db/schema";
import type { PaneId } from "../state/filesTabTypes";
import {
  applyProjectSearchReplace,
  previewProjectSearchReplace,
  rollbackProjectSearchReplace,
  searchProjectFileIndex,
} from "@/app/actions/files";
import { recordFilesMetric } from "@/lib/files/observability";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";

interface WorkspaceSearchReplaceProps {
  projectId: string;
  canEdit: boolean;
  nodesById: Record<string, ProjectNode>;
  activePane: PaneId;
  openFileInPane: (node: ProjectNode, pane?: PaneId) => Promise<void>;
  ensureNodeMetadata: (nodeIds: string[]) => Promise<void>;
  loadFileContent: (node: ProjectNode) => Promise<void>;
  tabByIdRef: React.RefObject<Record<string, { isDirty: boolean }>>;
  onClose: () => void;
}

export default function WorkspaceSearchReplace({
  projectId,
  canEdit,
  nodesById,
  activePane,
  openFileInPane,
  ensureNodeMetadata,
  loadFileContent,
  tabByIdRef,
  onClose,
}: WorkspaceSearchReplaceProps) {
  const { showToast } = useToast();

  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [findLoading, setFindLoading] = useState(false);
  const [findResults, setFindResults] = useState<Array<{ nodeId: string; snippet: string }>>([]);
  const [replacePreviewLoading, setReplacePreviewLoading] = useState(false);
  const [replaceApplying, setReplaceApplying] = useState(false);
  const [replacePreviewItems, setReplacePreviewItems] = useState<
    Array<{
      nodeId: string;
      name: string;
      parentId: string | null;
      occurrenceCount: number;
      beforeSnippet: string;
      afterSnippet: string;
    }>
  >([]);
  const [selectedReplaceNodeIds, setSelectedReplaceNodeIds] = useState<string[]>([]);
  const [lastReplaceBackup, setLastReplaceBackup] = useState<
    Array<{ nodeId: string; content: string }>
  >([]);
  const findInFlightRef = useRef<Map<string, Promise<Array<{ nodeId: string; snippet: string }>>>>(
    new Map()
  );
  const previewInFlightRef = useRef<
    Map<
      string,
      Promise<
        Awaited<ReturnType<typeof previewProjectSearchReplace>>
      >
    >
  >(new Map());

  useEffect(() => {
    const q = findQuery.trim();
    if (!q) {
      setFindResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      if (cancelled) return;
      const startedAt = performance.now();
      setFindLoading(true);
      try {
        const inFlight = findInFlightRef.current.get(q);
        const queryPromise =
          inFlight ??
          ((searchProjectFileIndex(projectId, q, 50) as Promise<
            Array<{ nodeId: string; snippet: string }>
          >).finally(() => {
            findInFlightRef.current.delete(q);
          }));
        if (!inFlight) findInFlightRef.current.set(q, queryPromise);
        const results = await queryPromise;
        if (cancelled) return;
        setFindResults(results);
        await ensureNodeMetadata(results.map((r: { nodeId: string }) => r.nodeId));
        recordFilesMetric("files.search.latency_ms", {
          projectId,
          value: Math.round(performance.now() - startedAt),
          extra: { queryLength: q.length, resultCount: results.length, surface: "find" },
        });
      } finally {
        if (!cancelled) setFindLoading(false);
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [ensureNodeMetadata, findQuery, projectId]);

  useEffect(() => {
    const q = findQuery.trim();
    if (!q || q.length < 2) {
      setReplacePreviewItems([]);
      setSelectedReplaceNodeIds([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      if (cancelled) return;
      const startedAt = performance.now();
      setReplacePreviewLoading(true);
      try {
        const previewKey = `${q}::${replaceQuery}`;
        const inFlight = previewInFlightRef.current.get(previewKey);
        const previewPromise =
          inFlight ??
          previewProjectSearchReplace(projectId, q, replaceQuery, 80).finally(() => {
            previewInFlightRef.current.delete(previewKey);
          });
        if (!inFlight) previewInFlightRef.current.set(previewKey, previewPromise);
        const res = await previewPromise;
        if (cancelled) return;
        if (res.success) {
          setReplacePreviewItems(res.items);
          const validIds = new Set(res.items.map((item) => item.nodeId));
          setSelectedReplaceNodeIds((prev) => {
            const kept = prev.filter((id) => validIds.has(id));
            return kept.length > 0 ? kept : res.items.map((item) => item.nodeId);
          });
          await ensureNodeMetadata(res.items.map((item) => item.nodeId));
        } else {
          setReplacePreviewItems([]);
          setSelectedReplaceNodeIds([]);
        }
        recordFilesMetric("files.search.latency_ms", {
          projectId,
          value: Math.round(performance.now() - startedAt),
          extra: {
            queryLength: q.length,
            resultCount: res.success ? res.items.length : 0,
            surface: "replace-preview",
          },
        });
      } finally {
        if (!cancelled) setReplacePreviewLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [ensureNodeMetadata, findQuery, projectId, replaceQuery]);

  const refreshFindReplaceData = useCallback(
    async (query: string, replacement: string) => {
      const trimmed = query.trim();
      if (!trimmed) {
        setFindResults([]);
        setReplacePreviewItems([]);
        setSelectedReplaceNodeIds([]);
        return;
      }
      const [findRows, previewRes] = await Promise.all([
        searchProjectFileIndex(projectId, trimmed, 50),
        previewProjectSearchReplace(projectId, trimmed, replacement, 80),
      ]);
      setFindResults(findRows as Array<{ nodeId: string; snippet: string }>);
      await ensureNodeMetadata(
        (findRows as Array<{ nodeId: string; snippet: string }>).map((row) => row.nodeId)
      );
      if (previewRes.success) {
        setReplacePreviewItems(previewRes.items);
        setSelectedReplaceNodeIds(
          previewRes.items.map((item: { nodeId: string }) => item.nodeId)
        );
      } else {
        setReplacePreviewItems([]);
        setSelectedReplaceNodeIds([]);
      }
    },
    [ensureNodeMetadata, projectId]
  );

  const handleApplyBatchReplace = useCallback(async () => {
    if (!canEdit) {
      showToast("Write access required", "error");
      return;
    }
    const q = findQuery.trim();
    if (q.length < 2) {
      showToast("Search query must be at least 2 characters", "error");
      return;
    }
    const nodeIds = Array.from(new Set(selectedReplaceNodeIds)).slice(0, 60);
    if (nodeIds.length === 0) {
      showToast("Select at least one file", "error");
      return;
    }

    setReplaceApplying(true);
    try {
      const res = await applyProjectSearchReplace(projectId, {
        query: q,
        replacement: replaceQuery,
        nodeIds,
      });
      if (!res.success) {
        showToast(res.error || "Replace failed", "error");
        return;
      }

      setLastReplaceBackup(res.backup || []);
      if ((res.changedNodeIds || []).length === 0) {
        showToast("No matches changed", "info");
        return;
      }

      await ensureNodeMetadata(res.changedNodeIds);
      for (const nodeId of res.changedNodeIds) {
        const tab = tabByIdRef.current[nodeId];
        if (tab?.isDirty) continue;
        const node =
          useFilesWorkspaceStore.getState().byProjectId[projectId]?.nodesById?.[nodeId];
        if (node && node.type === "file") {
          await loadFileContent(node);
        }
      }

      await refreshFindReplaceData(q, replaceQuery);
      showToast(`Replaced text in ${res.changedNodeIds.length} files`, "success");
    } finally {
      setReplaceApplying(false);
    }
  }, [
    canEdit,
    ensureNodeMetadata,
    findQuery,
    loadFileContent,
    projectId,
    refreshFindReplaceData,
    replaceQuery,
    selectedReplaceNodeIds,
    showToast,
    tabByIdRef,
  ]);

  const handleRollbackBatchReplace = useCallback(async () => {
    if (!canEdit) {
      showToast("Write access required", "error");
      return;
    }
    if (lastReplaceBackup.length === 0) {
      showToast("No replace operation to rollback", "info");
      return;
    }
    setReplaceApplying(true);
    try {
      const res = await rollbackProjectSearchReplace(projectId, lastReplaceBackup);
      if (!res.success) {
        showToast(res.error || "Rollback failed", "error");
        return;
      }

      await ensureNodeMetadata(res.restoredNodeIds || []);
      for (const nodeId of res.restoredNodeIds || []) {
        const tab = tabByIdRef.current[nodeId];
        if (tab?.isDirty) continue;
        const node =
          useFilesWorkspaceStore.getState().byProjectId[projectId]?.nodesById?.[nodeId];
        if (node && node.type === "file") {
          await loadFileContent(node);
        }
      }

      setLastReplaceBackup([]);
      await refreshFindReplaceData(findQuery, replaceQuery);
      showToast(
        `Rollback completed for ${(res.restoredNodeIds || []).length} files`,
        "success"
      );
    } finally {
      setReplaceApplying(false);
    }
  }, [
    canEdit,
    ensureNodeMetadata,
    findQuery,
    lastReplaceBackup,
    loadFileContent,
    projectId,
    refreshFindReplaceData,
    replaceQuery,
    showToast,
    tabByIdRef,
  ]);

  const handleClose = useCallback(() => {
    setFindQuery("");
    setReplaceQuery("");
    setFindResults([]);
    setReplacePreviewItems([]);
    setSelectedReplaceNodeIds([]);
    onClose();
  }, [onClose]);

  return (
    <div className="absolute inset-0 z-20 bg-black/30 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <div className="text-sm font-semibold">Find in project</div>
          <button
            className="p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-900"
            onClick={handleClose}
            aria-label="Close find"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input
              autoFocus
              className="w-full h-9 px-3 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm outline-none"
              placeholder="Search text (indexed on save)…"
              value={findQuery}
              onChange={(e) => setFindQuery(e.target.value)}
            />
            <input
              className="w-full h-9 px-3 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm outline-none"
              placeholder="Replace with..."
              value={replaceQuery}
              onChange={(e) => setReplaceQuery(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (replacePreviewItems.length === 0) return;
                setSelectedReplaceNodeIds(replacePreviewItems.map((item) => item.nodeId));
              }}
              disabled={replacePreviewItems.length === 0}
            >
              Select all
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelectedReplaceNodeIds([])}
              disabled={selectedReplaceNodeIds.length === 0}
            >
              Clear
            </Button>
            <Button
              size="sm"
              onClick={() => void handleApplyBatchReplace()}
              disabled={!canEdit || replaceApplying || selectedReplaceNodeIds.length === 0}
            >
              {replaceApplying ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Apply Replace
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleRollbackBatchReplace()}
              disabled={!canEdit || replaceApplying || lastReplaceBackup.length === 0}
            >
              Rollback Last
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-md border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              <div className="px-3 py-2 text-xs font-semibold border-b border-zinc-200 dark:border-zinc-800">
                Search Results
              </div>
              <div className="max-h-[38vh] overflow-auto">
                {findLoading ? (
                  <div className="p-3 text-sm text-zinc-500">Searching…</div>
                ) : findResults.length === 0 ? (
                  <div className="p-3 text-sm text-zinc-500">No results</div>
                ) : (
                  <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {findResults.map((r) => {
                      const node = nodesById[r.nodeId];
                      return (
                        <button
                          key={r.nodeId}
                          className="w-full text-left px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                          onClick={() => {
                            if (!node) return;
                            void openFileInPane(node, activePane);
                          }}
                        >
                          <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate">
                            {node?.name || r.nodeId}
                          </div>
                          <div className="text-xs text-zinc-500 font-mono whitespace-pre-wrap break-words mt-1">
                            {r.snippet}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-md border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              <div className="px-3 py-2 text-xs font-semibold border-b border-zinc-200 dark:border-zinc-800">
                Replace Preview ({selectedReplaceNodeIds.length} selected)
              </div>
              <div className="max-h-[38vh] overflow-auto">
                {replacePreviewLoading ? (
                  <div className="p-3 text-sm text-zinc-500">Preparing preview…</div>
                ) : replacePreviewItems.length === 0 ? (
                  <div className="p-3 text-sm text-zinc-500">No files to replace</div>
                ) : (
                  <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {replacePreviewItems.map((item) => {
                      const checked = selectedReplaceNodeIds.includes(item.nodeId);
                      const node = nodesById[item.nodeId];
                      return (
                        <div key={item.nodeId} className="px-3 py-2 space-y-1">
                          <label className="flex items-center gap-2 text-xs text-zinc-800 dark:text-zinc-200">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                setSelectedReplaceNodeIds((prev) => {
                                  if (e.target.checked)
                                    return Array.from(new Set([...prev, item.nodeId]));
                                  return prev.filter((id) => id !== item.nodeId);
                                });
                              }}
                            />
                            <span className="font-semibold truncate">
                              {node?.name || item.name}
                            </span>
                            <span className="text-zinc-500 ml-auto">
                              {item.occurrenceCount} hits
                            </span>
                          </label>
                          <div className="text-[11px] text-zinc-500 font-mono break-words">
                            {item.beforeSnippet}
                          </div>
                          <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-mono break-words">
                            {item.afterSnippet}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="text-xs text-zinc-400">
            Indexed-search scope only. Batch replace is fenced to selected files and can rollback
            the latest operation.
          </div>
        </div>
      </div>
    </div>
  );
}
