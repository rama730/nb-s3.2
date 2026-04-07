import { useCallback, useRef } from "react";
import type { ProjectNode } from "@/lib/db/schema";
import { getNodeMetadataBatch, getNodesByIds, getProjectFileSignedUrl } from "@/app/actions/files";
import { filesFeatureFlags } from "@/lib/features/files";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { logger } from "@/lib/logger";

interface UseTabMetadataPipelineOptions {
  projectId: string;
  upsertNodes: (projectId: string, nodes: ProjectNode[]) => void;
}

const LOOKUP_FAILURE_TTL_MS = 60_000;
const METADATA_BATCH_CHUNK_SIZE = 50;
const MAX_FAILED_LOOKUPS = 200;

export function useTabMetadataPipeline({
  projectId,
  upsertNodes,
}: UseTabMetadataPipelineOptions) {
  const failedLookupsRef = useRef<Map<string, number>>(new Map());
  const metadataInFlightRef = useRef<Map<string, Promise<void>>>(new Map());
  const signedUrlCacheRef = useRef<Map<string, { url: string; expiresAt: number }>>(new Map());
  const opsInProgressRef = useRef<Set<string>>(new Set());

  const ensureNodeMetadata = useCallback(
    async (nodeIds: string[]) => {
      if (nodeIds.length === 0) return;

      const now = Date.now();
      for (const [id, expiresAt] of failedLookupsRef.current.entries()) {
        if (expiresAt <= now) failedLookupsRef.current.delete(id);
      }

      const currentState = useFilesWorkspaceStore.getState();
      const currentWs = currentState.byProjectId[projectId];
      if (!currentWs) return;

      const pending: Promise<void>[] = [];
      const missing = nodeIds.filter(
        (id) =>
          !currentWs.nodesById[id] &&
          !failedLookupsRef.current.has(id) &&
          !metadataInFlightRef.current.has(id)
      );

      for (const id of nodeIds) {
        const existingPromise = metadataInFlightRef.current.get(id);
        if (existingPromise) pending.push(existingPromise);
      }

      if (missing.length > 0) {
        // Chunk into groups to prevent OOM on large metadata requests
        for (let i = 0; i < missing.length; i += METADATA_BATCH_CHUNK_SIZE) {
          const chunk = missing.slice(i, i + METADATA_BATCH_CHUNK_SIZE);
          const batchPromise = (async () => {
            chunk.forEach((id) => opsInProgressRef.current.add(`meta:${id}`));
            try {
              let nodes: ProjectNode[] = [];
              if (filesFeatureFlags.storeBatching || filesFeatureFlags.wave2StoreBatching) {
                const batch = await getNodeMetadataBatch(projectId, chunk, {
                  includeBreadcrumbs: false,
                });
                if (batch.success) {
                  nodes = batch.data.nodes;
                } else {
                  nodes = (await getNodesByIds(projectId, chunk)) as ProjectNode[];
                }
              } else {
                nodes = (await getNodesByIds(projectId, chunk)) as ProjectNode[];
              }
              const foundIds = new Set(nodes.map((n) => n.id));
              chunk.forEach((id) => {
                if (!foundIds.has(id)) {
                  failedLookupsRef.current.set(id, Date.now() + LOOKUP_FAILURE_TTL_MS);
                  return;
                }
                failedLookupsRef.current.delete(id);
              });
              if (nodes.length > 0) upsertNodes(projectId, nodes);
            } catch (error) {
              const failureExpiry = Date.now() + LOOKUP_FAILURE_TTL_MS;
              chunk.forEach((id) => failedLookupsRef.current.set(id, failureExpiry));
              logger.warn("Failed to fetch node metadata batch", {
                module: "workspace",
                projectId,
                count: chunk.length,
                error: error instanceof Error ? error.message : String(error),
              });
            } finally {
              chunk.forEach((id) => {
                opsInProgressRef.current.delete(`meta:${id}`);
                metadataInFlightRef.current.delete(id);
              });
            }
          })();
          chunk.forEach((id) => metadataInFlightRef.current.set(id, batchPromise));
          pending.push(batchPromise);
        }
      }

      if (pending.length > 0) {
        await Promise.all(pending);

        // Cap failedLookups to prevent unbounded growth
        if (failedLookupsRef.current.size > MAX_FAILED_LOOKUPS) {
          const entries = [...failedLookupsRef.current.entries()]
            .sort((a, b) => a[1] - b[1]);
          failedLookupsRef.current = new Map(entries.slice(-MAX_FAILED_LOOKUPS));
        }
      }
    },
    [projectId, upsertNodes]
  );

  const ensureSignedUrlForNode = useCallback(
    async (node: ProjectNode) => {
      if (!node?.id) return null;

      const cached = signedUrlCacheRef.current.get(node.id);
      const now = Date.now();
      if (cached && cached.expiresAt > now + 5_000) return cached.url;

      const ttlSeconds = 300;
      const res = (await getProjectFileSignedUrl(projectId, node.id, ttlSeconds)) as {
        url: string;
        expiresAt: number;
      };
      signedUrlCacheRef.current.set(node.id, {
        url: res.url,
        expiresAt: res.expiresAt,
      });
      return res.url;
    },
    [projectId]
  );

  return {
    opsInProgressRef,
    signedUrlCacheRef,
    ensureNodeMetadata,
    ensureSignedUrlForNode,
  };
}
