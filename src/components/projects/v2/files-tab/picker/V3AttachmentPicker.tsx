"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  getProjectNodes,
  getNodeMetadataBatch,
} from "@/app/actions/files/nodes";
import type { ProjectNode } from "@/lib/db/schema";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { FileIcon } from "../../explorer/FileIcons";
import { logger } from "@/lib/logger";

export interface V3AttachmentPickerProps {
  projectId: string;
  projectName?: string;
  isOpen: boolean;
  onClose: () => void;
  initialSelection?: ProjectNode[];
  onSelectionChange?: (nodes: ProjectNode[]) => void;
  selectionMode?: "single" | "multiple";
  excludedNodeIds?: readonly string[];
  footer?: React.ReactNode;
}
const EMPTY_IDS: string[] = [];

/** One authorized, paged read path shared by browsing and searching. No cached-only search. */
export function V3AttachmentPicker({
  projectId,
  projectName,
  isOpen,
  onClose,
  initialSelection,
  onSelectionChange,
  selectionMode = "multiple",
  excludedNodeIds = [],
  footer,
}: V3AttachmentPickerProps) {
  const [selectedNodes, setSelectedNodes] = useState<ProjectNode[]>(
    initialSelection ?? [],
  );
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState<ProjectNode | null>(null);
  const [ancestors, setAncestors] = useState<ProjectNode[]>([]);
  const [recent, setRecent] = useState(false);
  const recents = useFilesWorkspaceStore(
    (state) => state.byProjectId[projectId]?.recents ?? EMPTY_IDS,
  );
  const excluded = useMemo(() => new Set(excludedNodeIds), [excludedNodeIds]);
  useEffect(() => {
    if (initialSelection) setSelectedNodes(initialSelection);
  }, [initialSelection]);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(searchInput.trim()), 200);
    return () => clearTimeout(timer);
  }, [searchInput]);
  const perfMarkedRef = useRef(false);
  useEffect(() => {
    if (!isOpen) perfMarkedRef.current = false;
  }, [isOpen]);
  useEffect(() => {
    if (!isOpen) return;
    if (perfMarkedRef.current) return;
    perfMarkedRef.current = true;
    logger.metric("files_tab.picker_opened", {
      module: "files-tab",
      projectId,
    });
    if (typeof performance !== "undefined")
      performance.mark("files-tab:picker-interactive");
  }, [isOpen, projectId]);
  useEffect(() => {
    setFolder(null);
    setAncestors([]);
    setSearchInput("");
    setQuery("");
    setRecent(false);
  }, [projectId]);
  const files = useInfiniteQuery({
    queryKey: ["files-picker", projectId, folder?.id ?? null, query],
    enabled: isOpen && (!recent || !!query),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      getProjectNodes(projectId, folder?.id ?? null, query, 100, pageParam),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 30_000,
  });
  const recentFiles = useQuery({
    queryKey: [
      "files-picker-recent",
      projectId,
      recents.slice(0, 20).join(","),
    ],
    enabled: isOpen && recent && !query,
    queryFn: async () => {
      const ids = recents.slice(0, 20);
      if (!ids.length) return [];
      const result = await getNodeMetadataBatch(projectId, ids);
      if (!result.success) throw new Error(result.message);
      const order = new Map(ids.map((id, index) => [id, index]));
      return result.data.nodes.sort(
        (a, b) => order.get(a.id)! - order.get(b.id)!,
      );
    },
    staleTime: 30_000,
  });
  const showingRecent = recent && !query;
  const result = showingRecent ? recentFiles : files;
  const nodes = (
    showingRecent
      ? (recentFiles.data ?? [])
      : (files.data?.pages.flatMap((page) => page.nodes) ?? [])
  ).filter((node) => !node.deletedAt && !excluded.has(node.id));
  // Metadata only: a partial page must never mark a shared directory complete.
  useEffect(() => {
    const nodes = files.data?.pages.flatMap((page) => page.nodes);
    if (nodes) useFilesWorkspaceStore.getState().upsertNodes(projectId, nodes);
  }, [files.data, projectId]);
  function select(node: ProjectNode) {
    if (node.type === "folder") {
      if (folder) setAncestors((current) => [...current, folder]);
      setFolder(node);
      setSearchInput("");
      setQuery("");
      setRecent(false);
      return;
    }
    const selected = selectedNodes.some((item) => item.id === node.id);
    if (
      !selected &&
      selectionMode !== "single" &&
      selectedNodes.length >= 200
    ) {
      toast.info("Select up to 200 files at a time.");
      return;
    }
    const next =
      selectionMode === "single"
        ? [node]
        : selected
          ? selectedNodes.filter((item) => item.id !== node.id)
          : [...selectedNodes, node];
    setSelectedNodes(next);
    onSelectionChange?.(next);
  }
  function removeFromSelection(id: string) {
    const next = selectedNodes.filter((item) => item.id !== id);
    setSelectedNodes(next);
    onSelectionChange?.(next);
  }
  function root() {
    setFolder(null);
    setAncestors([]);
    setRecent(false);
    setSearchInput("");
    setQuery("");
  }
  function back() {
    setFolder(ancestors.at(-1) ?? null);
    setAncestors((current) => current.slice(0, -1));
    setSearchInput("");
    setQuery("");
  }
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-composer-portal="true"
        data-testid="v3-attachment-picker"
        showCloseButton={false}
        overlayClassName="z-[320]"
        className="z-[321] flex h-[min(80dvh,44rem)] w-[calc(100vw-2rem)] min-w-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
      >
        <header className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2">
          <DialogTitle className="min-w-0 truncate text-base">
            {projectName ? `Attach files — ${projectName}` : "Attach files"}
          </DialogTitle>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close picker"
            data-testid="v3-attachment-picker-close"
            className="flex size-10 shrink-0 items-center justify-center rounded focus-visible:ring-2"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav
            aria-label="Attachment locations"
            className="flex shrink-0 gap-1 border-b p-2 sm:w-44 sm:flex-col sm:border-b-0 sm:border-r"
          >
            <button
              type="button"
              aria-current={!recent ? "page" : undefined}
              onClick={root}
              className="min-h-10 rounded px-3 text-left text-sm hover:bg-zinc-100 focus-visible:ring-2 dark:hover:bg-zinc-800"
            >
              Project files
            </button>
            <button
              type="button"
              aria-current={recent ? "page" : undefined}
              onClick={() => {
                setRecent(true);
                setSearchInput("");
                setQuery("");
              }}
              className="min-h-10 rounded px-3 text-left text-sm hover:bg-zinc-100 focus-visible:ring-2 dark:hover:bg-zinc-800"
            >
              Recent files
            </button>
          </nav>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-3">
              {folder && !showingRecent && (
                <button
                  type="button"
                  aria-label="Back to previous folder"
                  onClick={back}
                  className="flex size-10 items-center justify-center rounded focus-visible:ring-2"
                >
                  <ArrowLeft className="size-4" />
                </button>
              )}
              <span className="max-w-40 truncate text-sm" title={folder?.name}>
                {showingRecent ? "Recent" : (folder?.name ?? "Project files")}
              </span>
              <label className="ml-auto flex min-w-0 flex-1 items-center gap-2 rounded border px-2 sm:max-w-sm">
                <Search
                  aria-hidden="true"
                  className="size-4 shrink-0 text-zinc-500"
                />
                <input
                  autoFocus
                  type="search"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  aria-label="Search files"
                  data-testid="v3-attachment-picker-search"
                  placeholder="Search all project files…"
                  className="h-10 w-full min-w-0 bg-transparent text-sm outline-none focus-visible:ring-2"
                />
              </label>
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto"
              data-testid="v3-attachment-picker-results"
            >
              {result.isError && (
                <p role="alert" className="p-4 text-sm">
                  Files could not be loaded.{" "}
                  <button
                    type="button"
                    onClick={() => void result.refetch()}
                    className="underline"
                  >
                    Retry
                  </button>
                </p>
              )}
              {result.isPending || query !== searchInput.trim() ? (
                <p role="status" className="p-4 text-sm text-zinc-500">
                  Loading files…
                </p>
              ) : (
                <>
                  {nodes.map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      aria-pressed={
                        node.type === "file"
                          ? selectedNodes.some((item) => item.id === node.id)
                          : undefined
                      }
                      data-testid={`v3-attachment-picker-result-${node.id}`}
                      onClick={() => select(node)}
                      className="flex min-h-12 w-full items-center gap-3 border-b border-zinc-100 px-4 py-2 text-left hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-inset dark:border-zinc-800 dark:hover:bg-zinc-900"
                    >
                      <FileIcon
                        name={node.name}
                        isFolder={node.type === "folder"}
                        className="size-4 shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">
                          {node.name}
                        </span>
                        {query && (
                          <span className="block truncate text-xs text-zinc-500">
                            {node.path.startsWith("/.system/")
                              ? "Task files"
                              : node.path}
                          </span>
                        )}
                      </span>
                      {selectedNodes.some((item) => item.id === node.id) && (
                        <span className="text-xs text-blue-600">Selected</span>
                      )}
                    </button>
                  ))}
                  {!nodes.length && !result.isError && (
                    <p className="p-4 text-sm text-zinc-500">
                      {query.length === 1
                        ? "Type at least two characters to search."
                        : query
                          ? "No matching files."
                          : showingRecent
                            ? "No recent files."
                            : "This folder is empty."}
                    </p>
                  )}
                  {!showingRecent && files.hasNextPage && (
                    <button
                      type="button"
                      disabled={files.isFetchingNextPage}
                      onClick={() => void files.fetchNextPage()}
                      className="m-3 min-h-10 rounded border px-4 text-sm"
                    >
                      {files.isFetchingNextPage
                        ? "Loading…"
                        : "Load more files"}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        <div
          className="max-h-28 shrink-0 overflow-y-auto border-t px-4 py-2"
          data-testid="v3-attachment-picker-tray"
        >
          {!selectedNodes.length ? (
            <p className="text-xs text-zinc-500">No files selected</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {selectedNodes.map((node) => (
                <span
                  key={node.id}
                  data-testid={`v3-attachment-picker-chip-${node.id}`}
                  className="inline-flex min-h-9 max-w-full items-center gap-1 rounded-md bg-blue-50 pl-2 text-xs text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
                >
                  <span className="max-w-40 truncate">{node.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${node.name}`}
                    data-testid={`v3-attachment-picker-chip-remove-${node.id}`}
                    onClick={() => removeFromSelection(node.id)}
                    className="flex size-9 items-center justify-center rounded focus-visible:ring-2"
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        {footer && (
          <div
            className="shrink-0 border-t px-4 py-3"
            data-testid="v3-attachment-picker-footer"
          >
            {footer}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
export default V3AttachmentPicker;
