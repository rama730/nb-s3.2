"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import {
    listProjectReadmeVersionsAction,
    readProjectReadmeAction,
    readProjectReadmeDraftAction,
    readProjectReadmeImportCandidatesAction,
    readProjectReadmeReferenceOptionsAction,
    readProjectReadmeSettingsAction,
    readProjectReadmeSmartBlockPreviewsAction,
} from "@/app/actions/project";
import { queryKeys } from "@/lib/query-keys";
import type {
    ProjectReadmeReferenceKind,
    ProjectReadmeSmartBlock,
    ProjectReadmeSmartBlockPreview,
} from "@/lib/projects/readme-blocks";

export const PROJECT_README_QUERY_KEY = (projectId: string) =>
    queryKeys.project.detail.readme(projectId);
export const PROJECT_README_DRAFT_QUERY_KEY = (projectId: string) =>
    queryKeys.project.detail.readmeDraft(projectId);
export const PROJECT_README_VERSIONS_QUERY_KEY = (projectId: string) =>
    queryKeys.project.detail.readmeVersions(projectId);
export const PROJECT_README_SETTINGS_QUERY_KEY = (projectId: string) =>
    queryKeys.project.detail.readmeSettings(projectId);
export const PROJECT_README_REFERENCES_QUERY_KEY = (projectId: string, kind: ProjectReadmeReferenceKind, query: string) =>
    queryKeys.project.detail.readmeReferences(projectId, kind, query.trim());
export const PROJECT_README_IMPORT_CANDIDATES_QUERY_KEY = (projectId: string, query: string) =>
    queryKeys.project.detail.readmeImportCandidates(projectId, query.trim());
export const PROJECT_README_SMART_BLOCK_PREVIEWS_QUERY_KEY = (projectId: string, blockSignature: string) =>
    queryKeys.project.detail.readmeSmartBlockPreviews(projectId, blockSignature);

export function useProjectReadme(projectId: string) {
    return useQuery({
        queryKey: PROJECT_README_QUERY_KEY(projectId),
        queryFn: async () => {
            const result = await readProjectReadmeAction(projectId);
            if (!result.success) throw new Error(result.error);
            return result.data;
        },
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
    });
}

export function useProjectReadmeDraft(projectId: string, enabled = true) {
    return useQuery({
        queryKey: PROJECT_README_DRAFT_QUERY_KEY(projectId),
        queryFn: async () => {
            const result = await readProjectReadmeDraftAction(projectId);
            if (!result.success) throw new Error(result.error);
            return result.data;
        },
        staleTime: 1000 * 60,
        refetchOnWindowFocus: false,
        enabled,
    });
}

export function useProjectReadmeVersions(projectId: string, enabled = true) {
    return useQuery({
        queryKey: PROJECT_README_VERSIONS_QUERY_KEY(projectId),
        queryFn: async () => {
            const result = await listProjectReadmeVersionsAction(projectId);
            if (!result.success) throw new Error(result.error);
            return result.versions;
        },
        staleTime: 1000 * 60 * 2,
        refetchOnWindowFocus: false,
        enabled,
    });
}

export function useProjectReadmeSettings(projectId: string, enabled = true) {
    return useQuery({
        queryKey: PROJECT_README_SETTINGS_QUERY_KEY(projectId),
        queryFn: async () => {
            const result = await readProjectReadmeSettingsAction(projectId);
            if (!result.success) throw new Error(result.error);
            return result.settings;
        },
        staleTime: 1000 * 60 * 2,
        refetchOnWindowFocus: false,
        enabled,
    });
}

export function useProjectReadmeReferenceOptions(projectId: string, kind: ProjectReadmeReferenceKind, query: string, enabled = true) {
    return useQuery({
        queryKey: PROJECT_README_REFERENCES_QUERY_KEY(projectId, kind, query),
        queryFn: async () => {
            const result = await readProjectReadmeReferenceOptionsAction(projectId, { kind, query, limit: 12 });
            if (!result.success) throw new Error(result.error);
            return result.options;
        },
        staleTime: 1000 * 30,
        refetchOnWindowFocus: false,
        enabled,
    });
}

export function useProjectReadmeImportCandidates(projectId: string, query: string, enabled = true) {
    return useQuery({
        queryKey: PROJECT_README_IMPORT_CANDIDATES_QUERY_KEY(projectId, query),
        queryFn: async () => {
            const result = await readProjectReadmeImportCandidatesAction(projectId, { query, limit: 12 });
            if (!result.success) throw new Error(result.error);
            return result.candidates;
        },
        staleTime: 1000 * 30,
        refetchOnWindowFocus: false,
        enabled,
    });
}

const SMART_BLOCK_CACHE = new Map<string, ProjectReadmeSmartBlockPreview>();

export function useProjectReadmeSmartBlockPreviews(projectId: string, blocks: ProjectReadmeSmartBlock[], enabled = true) {
    const blockSignature = useMemo(() => {
        const uniqueBlocks = new Map<string, { kind: string; ids: string[] }>();
        blocks.forEach((b) => {
            const key = `${b.kind}:${[...(b.ids ?? [])].sort().join(",")}`;
            uniqueBlocks.set(key, { kind: b.kind, ids: b.ids });
        });
        const sorted = Array.from(uniqueBlocks.values()).sort((a, b) => {
            const ak = `${a.kind}:${[...(a.ids ?? [])].sort().join(",")}`;
            const bk = `${b.kind}:${[...(b.ids ?? [])].sort().join(",")}`;
            return ak.localeCompare(bk);
        });
        return JSON.stringify(sorted);
    }, [blocks]);

    return useQuery({
        queryKey: PROJECT_README_SMART_BLOCK_PREVIEWS_QUERY_KEY(projectId, blockSignature),
        queryFn: async () => {
            // Deduplicate blocks before querying to prevent redundant database resolutions
            const uniqueMap = new Map<string, { kind: ProjectReadmeReferenceKind | "unknown"; ids: string[]; index: number }>();
            blocks.forEach((b, idx) => {
                const key = `${b.kind}:${[...(b.ids ?? [])].sort().join(",")}`;
                if (!uniqueMap.has(key)) {
                    uniqueMap.set(key, { kind: b.kind, ids: b.ids, index: idx });
                }
            });
            const uniqueBlocksList = Array.from(uniqueMap.values());
            if (!uniqueBlocksList.length) return [];

            const missingBlocks: typeof uniqueBlocksList = [];
            const previews: ProjectReadmeSmartBlockPreview[] = [];

            for (const b of uniqueBlocksList) {
                const cacheKey = `${projectId}:${b.kind}:${[...(b.ids ?? [])].sort().join(",")}`;
                if (SMART_BLOCK_CACHE.has(cacheKey)) {
                    previews.push(SMART_BLOCK_CACHE.get(cacheKey)!);
                } else {
                    missingBlocks.push(b);
                }
            }

            if (missingBlocks.length > 0) {
                const chunks: any[][] = [];
                for (let index = 0; index < missingBlocks.length; index += 20) {
                    chunks.push(missingBlocks.slice(index, index + 20));
                }
                const results = await Promise.all(chunks.map((chunk) => readProjectReadmeSmartBlockPreviewsAction(projectId, chunk)));
                for (const result of results) {
                    if (!result.success) throw new Error(result.error);
                    for (const preview of result.previews) {
                        const cacheKey = `${projectId}:${preview.key}`;
                        SMART_BLOCK_CACHE.set(cacheKey, preview);
                        previews.push(preview);
                    }
                }
            }
            return previews;
        },
        staleTime: 1000 * 60,
        refetchOnWindowFocus: false,
        placeholderData: (previous) => previous,
        enabled: enabled && blocks.length > 0,
    });
}
