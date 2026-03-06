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

  useEffect(() => {
    workerRef.current = new Worker(new URL("./search.worker.ts", import.meta.url));
    return () => {
      workerRef.current?.terminate();
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
          workerRef.current.onmessage = async (e) => {
            if (e.data.type !== "SEARCH_COMPLETE") return;
            if (requestId !== searchRequestIdRef.current) return;
            const { orderedIds, snippets } = e.data;
            searchSnippetsRef.current = snippets;

            const latestNodesByIdBeforeHydrate =
              useFilesWorkspaceStore.getState().byProjectId[projectId]?.nodesById || {};
            const missing = orderedIds.filter((id: string) => !latestNodesByIdBeforeHydrate[id]);
            
            if (missing.length > 0) {
              const hydrated = (await getNodesByIds(projectId, missing)) as ProjectNode[];
              if (requestId !== searchRequestIdRef.current) return;
              if (hydrated.length > 0) upsertNodes(projectId, hydrated);
            }

            const latestNodesById =
              useFilesWorkspaceStore.getState().byProjectId[projectId]?.nodesById || {};
            const orderedNodes = orderedIds
              .map((id: string) => latestNodesById[id])
              .filter((node: ProjectNode | undefined): node is ProjectNode => !!node);
            setSearchResults(orderedNodes);

            const fileIds = orderedNodes.filter((n: ProjectNode) => n.type === "file").map((n: ProjectNode) => n.id);
            if (fileIds.length) {
              const counts = await getTaskLinkCounts(projectId, fileIds);
              if (requestId !== searchRequestIdRef.current) return;
              setTaskLinkCounts(projectId, counts);
            }
            
            if (requestId === searchRequestIdRef.current) {
              setIsSearching(false);
            }
          };
          workerRef.current.postMessage({ type: "SEARCH", payload: { query: q, federated } });
        }
      } catch (_err) {
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
