"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-keys";
import type {
    ProjectDocReferenceKind,
    ProjectDocSmartBlock,
    ProjectDocSmartBlockPreview,
} from "@/lib/projects/doc-blocks";
import { normalizeProjectDocSlug } from "@/lib/projects/doc";

export const PROJECT_DOC_QUERY_KEY = (projectId: string, docSlug: string = "readme") =>
    [...queryKeys.project.detail.readme(projectId), normalizeProjectDocSlug(docSlug)] as const;
export const PROJECT_DOC_SETTINGS_QUERY_KEY = (projectId: string, docSlug: string = "readme") =>
    [...queryKeys.project.detail.readmeSettings(projectId), normalizeProjectDocSlug(docSlug)] as const;
export const PROJECT_DOC_REFERENCES_QUERY_KEY = (projectId: string, kind: ProjectDocReferenceKind, query: string) =>
    queryKeys.project.detail.readmeReferences(projectId, kind, query.trim());
export const PROJECT_DOC_IMPORT_CANDIDATES_QUERY_KEY = (projectId: string, query: string) =>
    queryKeys.project.detail.readmeImportCandidates(projectId, query.trim());
export const PROJECT_DOC_SMART_BLOCK_PREVIEWS_QUERY_KEY = (projectId: string, blockSignature: string) =>
    queryKeys.project.detail.readmeSmartBlockPreviews(projectId, blockSignature);

export function useProjectDoc(projectId: string, docSlug: string = "readme") {
    return useQuery({
        queryKey: PROJECT_DOC_QUERY_KEY(projectId, docSlug),
        queryFn: async () => {
            const { readProjectDocAction } = await import("@/app/actions/project");
            const result = await readProjectDocAction(projectId, docSlug);
            if (!result.success) throw new Error(result.error);
            return result.data;
        },
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
    });
}

export function useProjectDocSettings(projectId: string, docSlug: string = "readme", enabled = true) {
    return useQuery({
        queryKey: PROJECT_DOC_SETTINGS_QUERY_KEY(projectId, docSlug),
        queryFn: async () => {
            const { readProjectDocSettingsAction } = await import("@/app/actions/project");
            const result = await readProjectDocSettingsAction(projectId, docSlug);
            if (!result.success) throw new Error(result.error);
            return result.settings;
        },
        staleTime: 1000 * 60 * 2,
        refetchOnWindowFocus: false,
        enabled,
    });
}

export function useProjectDocReferenceOptions(projectId: string, kind: ProjectDocReferenceKind, query: string, enabled = true) {
    return useQuery({
        queryKey: PROJECT_DOC_REFERENCES_QUERY_KEY(projectId, kind, query),
        queryFn: async () => {
            const { readProjectDocReferenceOptionsAction } = await import("@/app/actions/project");
            const result = await readProjectDocReferenceOptionsAction(projectId, { kind, query, limit: 12 });
            if (!result.success) throw new Error(result.error);
            return result.options;
        },
        staleTime: 1000 * 30,
        refetchOnWindowFocus: false,
        enabled,
    });
}

const SMART_BLOCK_CACHE = new Map<string, ProjectDocSmartBlockPreview>();

export function useProjectDocSmartBlockPreviews(projectId: string, blocks: ProjectDocSmartBlock[], enabled = true) {
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
        queryKey: PROJECT_DOC_SMART_BLOCK_PREVIEWS_QUERY_KEY(projectId, blockSignature),
        queryFn: async () => {
            // Deduplicate blocks before querying to prevent redundant database resolutions
            const uniqueMap = new Map<string, { kind: ProjectDocReferenceKind | "unknown"; ids: string[]; index: number }>();
            blocks.forEach((b, idx) => {
                const key = `${b.kind}:${[...(b.ids ?? [])].sort().join(",")}`;
                if (!uniqueMap.has(key)) {
                    uniqueMap.set(key, { kind: b.kind, ids: b.ids, index: idx });
                }
            });
            const uniqueBlocksList = Array.from(uniqueMap.values());
            if (!uniqueBlocksList.length) return [];

            const missingBlocks: typeof uniqueBlocksList = [];
            const previews: ProjectDocSmartBlockPreview[] = [];

            for (const b of uniqueBlocksList) {
                const cacheKey = `${projectId}:${b.kind}:${[...(b.ids ?? [])].sort().join(",")}`;
                if (SMART_BLOCK_CACHE.has(cacheKey)) {
                    previews.push(SMART_BLOCK_CACHE.get(cacheKey)!);
                } else {
                    missingBlocks.push(b);
                }
            }

            if (missingBlocks.length > 0) {
                const { readProjectDocSmartBlockPreviewsAction } = await import("@/app/actions/project");
                const chunks: any[][] = [];
                for (let index = 0; index < missingBlocks.length; index += 20) {
                    chunks.push(missingBlocks.slice(index, index + 20));
                }
                const results = await Promise.all(chunks.map((chunk) => readProjectDocSmartBlockPreviewsAction(projectId, chunk)));
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
        enabled: enabled && blocks.length > 0,
    });
}

export const PROJECT_MARKDOWNS_LIST_QUERY_KEY = (projectId: string) =>
    ["project", projectId, "detail", "markdowns_list"] as const;

export function useProjectMarkdowns(projectId: string) {
    return useQuery({
        queryKey: PROJECT_MARKDOWNS_LIST_QUERY_KEY(projectId),
        queryFn: async () => {
            const { listProjectMarkdownsAction } = await import("@/app/actions/project");
            const result = await listProjectMarkdownsAction(projectId);
            if (!result.success) throw new Error(result.error);
            return result.markdowns;
        },
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
    });
}
