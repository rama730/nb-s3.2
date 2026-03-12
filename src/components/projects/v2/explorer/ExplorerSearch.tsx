"use client";

import { useEffect, useRef, useState } from "react";
import {
  getNodesByIds,
  getTaskLinkCounts,
  getTrashNodes,
  searchProjectNodesFederated,
} from "@/app/actions/files";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import type { ProjectNode } from "@/lib/db/schema";
import type { SearchWorkerResponse } from "./workerContracts";

export function useExplorerSearch(options: {
  projectId: string;
  searchQuery: string;
  explorerMode: string;
}) {
  const { projectId, searchQuery, explorerMode } = options;

  const upsertNodes = useFilesWorkspaceStore((s) => s.upsertNodes);
  const setTaskLinkCounts = useFilesWorkspaceStore((s) => s.setTaskLinkCounts);
  const nodesById = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.nodesById || {});

  const [searchResults, setSearchResults] = useState<ProjectNode[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [trashNodesState, setTrashNodesState] = useState<ProjectNode[]>([]);
  const [isTrashLoading, setIsTrashLoading] = useState(false);
  const [inlineSearchOpen, setInlineSearchOpen] = useState(false);

  const searchRequestIdRef = useRef(0);
  const trashRequestIdRef = useRef(0);
  const searchSnippetsRef = useRef<Record<string, string | null>>({});
  const workerRef = useRef<Worker | null>(null);

  const latestStateRef = useRef({ projectId, upsertNodes, setTaskLinkCounts });
  useEffect(() => {
    latestStateRef.current = { projectId, upsertNodes, setTaskLinkCounts };
  }, [projectId, upsertNodes, setTaskLinkCounts]);

  useEffect(() => {
    const worker = new Worker(new URL("./search.worker.ts", import.meta.url));
    workerRef.current = worker;

    const handler = async (e: MessageEvent<SearchWorkerResponse>) => {
      if (e.data.type === "SEARCH_ERROR") {
        const responseJobId = e.data.jobId ?? e.data.requestId;
        if (responseJobId !== searchRequestIdRef.current) return;
        console.warn("[ExplorerSearch] search worker error", { jobId: responseJobId, error: e.data.error });
        setIsSearching(false);
        return;
      }

      if (e.data.type !== "SEARCH_COMPLETE") return;
      const responseJobId = e.data.jobId ?? e.data.requestId;
      const { orderedIds, snippets } = e.data;
      if (responseJobId !== searchRequestIdRef.current) return;

      const {
        projectId: pid,
        upsertNodes: upsert,
        setTaskLinkCounts: stlc,
      } = latestStateRef.current;

      searchSnippetsRef.current = snippets;

      try {
        const latestNodesByIdBeforeHydrate =
          useFilesWorkspaceStore.getState().byProjectId[pid]?.nodesById || {};
        const missing = orderedIds.filter((id: string) => !latestNodesByIdBeforeHydrate[id]);

        if (missing.length > 0) {
          const hydrated = (await getNodesByIds(pid, missing)) as ProjectNode[];
          if (responseJobId !== searchRequestIdRef.current) return;
          if (hydrated.length > 0) upsert(pid, hydrated);
        }

        const latestNodesById = useFilesWorkspaceStore.getState().byProjectId[pid]?.nodesById || {};
        const orderedNodes = orderedIds
          .map((id: string) => latestNodesById[id])
          .filter((node: ProjectNode | undefined): node is ProjectNode => !!node);
        setSearchResults(orderedNodes);

        const fileIds = orderedNodes
          .filter((n: ProjectNode) => n.type === "file")
          .map((n: ProjectNode) => n.id);
        if (fileIds.length) {
          const counts = await getTaskLinkCounts(pid, fileIds);
          if (responseJobId !== searchRequestIdRef.current) return;
          stlc(pid, counts);
        }
      } catch (error) {
        console.error("[ExplorerSearch] handler error during hydration/counts", {
          jobId: responseJobId,
          error,
        });
        return;
      } finally {
        if (responseJobId === searchRequestIdRef.current) {
          setIsSearching(false);
        }
      }
    };

    worker.addEventListener("message", handler);
    worker.onerror = (event) => {
      console.error("[ExplorerSearch] worker runtime error", {
        message: event.message,
        fileName: event.filename,
        line: event.lineno,
        column: event.colno,
      });
      setIsSearching(false);
    };

    return () => {
      worker.removeEventListener("message", handler);
      worker.terminate();
    };
  }, []);

  // Phase 5: Rebuild Inverted Search Index silently when files change
  useEffect(() => {
    if (workerRef.current && Object.keys(nodesById).length > 0) {
      workerRef.current.postMessage({ type: "INIT_INDEX", payload: { nodesById } });
    }
  }, [nodesById]);

  useEffect(() => {
    if (searchQuery.trim()) {
      setInlineSearchOpen(true);
    }
  }, [searchQuery]);

  // Federated search
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setIsSearching(false);
      searchSnippetsRef.current = {};
      searchRequestIdRef.current += 1;
      return;
    }
    if (q.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      searchSnippetsRef.current = {};
      searchRequestIdRef.current += 1;
      return;
    }

    const requestId = ++searchRequestIdRef.current;
    const t = setTimeout(async () => {
      setIsSearching(true);
      try {
        const federated = await searchProjectNodesFederated(projectId, q, 80);
        if (requestId !== searchRequestIdRef.current) return;
        
        if (federated.length === 0) {
          setSearchResults([]);
          setIsSearching(false);
          return;
        }

        if (workerRef.current) {
          workerRef.current.postMessage({
            type: "SEARCH",
            payload: { query: q, federated, requestId, jobId: requestId },
          });
        }
      } catch {
        if (requestId === searchRequestIdRef.current) {
          setIsSearching(false);
        }
      }
    }, 200);

    return () => clearTimeout(t);
  }, [projectId, upsertNodes, searchQuery, setTaskLinkCounts]);

  // Trash listing
  useEffect(() => {
    if (explorerMode !== "trash") return;
    const requestId = ++trashRequestIdRef.current;
    setIsTrashLoading(true);
    void (async () => {
      try {
        const nodes = (await getTrashNodes(
          projectId,
          searchQuery.trim() || undefined
        )) as ProjectNode[];
        if (requestId !== trashRequestIdRef.current) return;
        upsertNodes(projectId, nodes);
        setTrashNodesState(nodes);
      } finally {
        if (requestId === trashRequestIdRef.current) {
          setIsTrashLoading(false);
        }
      }
    })();
  }, [projectId, upsertNodes, explorerMode, searchQuery]);

  return {
    searchResults,
    isSearching,
    trashNodesState,
    setTrashNodesState,
    isTrashLoading,
    inlineSearchOpen,
    setInlineSearchOpen,
    searchSnippetsRef,
  };
}
