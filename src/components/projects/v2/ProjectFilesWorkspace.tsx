// Files-tab entry point — post-rollout (V2 cleanup complete).
//
// `ProjectFilesWorkspace` always mounts `FilesTabRoot`. Legacy V2-only
// props (`initialOpenLine`, `initialOpenColumn`, `initialFileNodes`,
// `importSourceType`) are accepted for source-compat with the existing
// `ProjectTabsRegistry` callsite but dropped on the way through
// (`adaptToV3Props`).
//
// `adaptToV3Props` and the V3 prop type stay exported because
// `tests/unit/files-tab/entry-gating.test.ts` exercises the adapter
// directly.

"use client";

import React from "react";
import dynamic from "next/dynamic";
import type { ProjectNode } from "@/lib/db/schema";

const FilesTabRoot = dynamic(
    () => import("./files-tab/FilesTabRoot").then((m) => m.FilesTabRoot),
    { ssr: false },
);

// ─── Props contract ─────────────────────────────────────────────────

export interface ProjectFilesWorkspaceProps {
    projectId: string;
    projectName?: string;
    currentUserId?: string;
    isOwnerOrMember: boolean;
    isActive?: boolean;
    initialFileNodes?: ProjectNode[];
    syncStatus?: "pending" | "cloning" | "indexing" | "ready" | "failed";
    importSourceType?: "github" | "upload" | "scratch" | null;
    initialOpenPath?: string | null;
    /** Legacy V2 line-target; V3 has no line targeting and this is dropped. */
    initialOpenLine?: number | null;
    /** Legacy V2 column-target; V3 has no line targeting and this is dropped. */
    initialOpenColumn?: number | null;
}

export interface FilesTabV3Props {
    projectId: string;
    projectName?: string;
    currentUserId?: string;
    isOwnerOrMember: boolean;
    isActive?: boolean;
    syncStatus?: "pending" | "cloning" | "indexing" | "ready" | "failed";
    initialOpenPath?: string | null;
}

/**
 * Drops V2-only props (`initialOpenLine`, `initialOpenColumn`,
 * `initialFileNodes`, `importSourceType`) and forwards the rest into the
 * V3 `FilesTabRoot` surface. Pure; exported for the entry-gating test.
 */
export function adaptToV3Props(
    props: ProjectFilesWorkspaceProps,
): FilesTabV3Props {
    return {
        projectId: props.projectId,
        projectName: props.projectName,
        currentUserId: props.currentUserId,
        isOwnerOrMember: props.isOwnerOrMember,
        isActive: props.isActive,
        syncStatus: props.syncStatus,
        initialOpenPath: props.initialOpenPath ?? null,
    };
}

export default function ProjectFilesWorkspace(
    props: ProjectFilesWorkspaceProps,
): React.JSX.Element {
    return <FilesTabRoot {...adaptToV3Props(props)} />;
}
