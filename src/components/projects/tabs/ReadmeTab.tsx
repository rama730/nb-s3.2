"use client";

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { BookOpenText, Loader2 } from "lucide-react";

import {
    deleteProjectReadmeVersionAction,
    discardProjectReadmeDraftAction,
    importProjectReadmeFromFileAction,
    publishProjectReadmeAction,
    readProjectReadmeDraftAction,
    restoreProjectReadmeVersionAction,
    saveProjectReadmeDraftAction,
    setProjectReadmePublishedVersionAction,
} from "@/app/actions/project";
import { ProjectReadmeEmptyState } from "@/components/projects/readme/ProjectReadmeEmptyState";
import { ProjectReadmeViewer } from "@/components/projects/readme/ProjectReadmeViewer";
import { SkeletonReadme } from "@/components/projects/skeletons/SkeletonReadme";
import {
    PROJECT_README_DRAFT_QUERY_KEY,
    PROJECT_README_QUERY_KEY,
    PROJECT_README_VERSIONS_QUERY_KEY,
    useProjectReadme,
    useProjectReadmeDraft,
} from "@/hooks/hub/useProjectReadmeData";
import type { ProjectReadmeDraftPayload, ProjectReadmeQualityReport } from "@/lib/projects/readme";
import type { Project } from "@/types/hub";

const ProjectReadmeEditor = dynamic(
    () => import("@/components/projects/readme/ProjectReadmeEditor").then((mod) => ({ default: mod.ProjectReadmeEditor })),
    { loading: () => <SkeletonReadme />, ssr: false },
);

export default function ReadmeTab({
    projectId,
    project,
    currentUserName,
    onEditingChange,
}: {
    projectId: string;
    project: Project;
    currentUserId?: string | null;
    currentUserName?: string;
    canEditProject?: boolean;
    onEditingChange?: (editing: boolean) => void;
}) {
    const queryClient = useQueryClient();
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [importing, setImporting] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const readmeQuery = useProjectReadme(projectId);
    const canEdit = Boolean(readmeQuery.data?.canEdit);
    const draftQuery = useProjectReadmeDraft(projectId, editing);

    useEffect(() => {
        onEditingChange?.(editing);
    }, [editing, onEditingChange]);

    useEffect(() => () => {
        onEditingChange?.(false);
    }, [onEditingChange]);

    useEffect(() => {
        if (!canEdit || typeof window === "undefined") return;
        const url = new URL(window.location.href);
        if (url.searchParams.get("readmeMode") !== "edit") return;
        setEditing(true);
        url.searchParams.delete("readmeMode");
        window.history.replaceState(null, "", url.toString());
    }, [canEdit, projectId]);

    const invalidatePublishedReadme = useCallback(() => {
        void queryClient.invalidateQueries({ queryKey: PROJECT_README_QUERY_KEY(projectId) });
    }, [projectId, queryClient]);

    const invalidateDraftReadme = useCallback(() => {
        void queryClient.invalidateQueries({ queryKey: PROJECT_README_DRAFT_QUERY_KEY(projectId) });
    }, [projectId, queryClient]);

    const invalidateReadmeVersions = useCallback(() => {
        void queryClient.invalidateQueries({ queryKey: PROJECT_README_VERSIONS_QUERY_KEY(projectId) });
    }, [projectId, queryClient]);

    const updateDraftCache = useCallback((patch: Partial<ProjectReadmeDraftPayload>) => {
        queryClient.setQueryData<ProjectReadmeDraftPayload | undefined>(
            PROJECT_README_DRAFT_QUERY_KEY(projectId),
            (current) => current ? { ...current, ...patch } : current,
        );
    }, [projectId, queryClient]);

    useEffect(() => {
        if (!canEdit || typeof window === "undefined") return;
        const timer = window.setTimeout(() => {
            (ProjectReadmeEditor as unknown as { preload?: () => void }).preload?.();
            void queryClient.prefetchQuery({
                queryKey: PROJECT_README_DRAFT_QUERY_KEY(projectId),
                queryFn: async () => {
                    const result = await readProjectReadmeDraftAction(projectId);
                    if (!result.success) throw new Error(result.error);
                    return result.data;
                },
                staleTime: 1000 * 60,
            });
        }, 400);
        return () => window.clearTimeout(timer);
    }, [canEdit, projectId, queryClient]);

    const startEditing = useCallback(() => {
        (ProjectReadmeEditor as unknown as { preload?: () => void }).preload?.();
        setEditing(true);
    }, []);

    const handleCreate = useCallback(() => {
        const content = `# ${project.title || "Project README"}\n\n`;
        startEditing();
        window.setTimeout(() => {
            void saveProjectReadmeDraftAction(projectId, { content }).then((result) => {
                if (!result.success) toast.error(result.error);
                if (result.success) {
                    updateDraftCache({
                        draftContent: content,
                        draftUpdatedAt: result.draftUpdatedAt ?? null,
                        qualityReport: result.qualityReport,
                    });
                }
                invalidateDraftReadme();
            });
        }, 0);
    }, [invalidateDraftReadme, project.title, projectId, startEditing, updateDraftCache]);

    const handleSave = useCallback(async (content: string, expectedDraftUpdatedAt: string | null): Promise<{
        qualityReport: ProjectReadmeQualityReport;
        draftUpdatedAt: string | null;
        conflict?: boolean;
        serverDraftContent?: string;
    } | null> => {
        setSaving(true);
        try {
            const result: any = await saveProjectReadmeDraftAction(projectId, { content, expectedDraftUpdatedAt });
            if (!result.success) {
                if (!("code" in result) || result.code !== "CONFLICT") toast.error(result.error);
                if ("code" in result && result.code === "CONFLICT") {
                    return {
                        qualityReport: result.qualityReport,
                        draftUpdatedAt: result.serverDraftUpdatedAt,
                        conflict: true,
                        serverDraftContent: result.serverDraftContent,
                    };
                }
                return null;
            }
            updateDraftCache({
                draftContent: content,
                draftUpdatedAt: result.draftUpdatedAt ?? null,
                qualityReport: result.qualityReport,
            });
            return { qualityReport: result.qualityReport, draftUpdatedAt: result.draftUpdatedAt ?? null };
        } finally {
            setSaving(false);
        }
    }, [projectId, updateDraftCache]);

    const handlePublish = useCallback(async (content: string, expectedDraftUpdatedAt: string | null, changeSummary: string, syncToFilesTab: boolean) => {
        setPublishing(true);
        try {
            const result = await publishProjectReadmeAction(projectId, { content, expectedDraftUpdatedAt, changeSummary, syncToFilesTab });
            if (!result.success) {
                if ("code" in result && result.code === "CONFLICT") {
                    toast.error("README changed elsewhere. Review the latest draft before publishing.");
                } else {
                    toast.error(result.error);
                }
                return false;
            }
            toast.success("README published");
            setEditing(false);
            invalidatePublishedReadme();
            invalidateDraftReadme();
            invalidateReadmeVersions();
            return true;
        } finally {
            setPublishing(false);
        }
    }, [invalidateDraftReadme, invalidatePublishedReadme, invalidateReadmeVersions, projectId]);

    const handleRestore = useCallback(async (versionId: string) => {
        const result = await restoreProjectReadmeVersionAction(projectId, versionId);
        if (!result.success) {
            toast.error(result.error);
            return null;
        }
        updateDraftCache({
            draftContent: result.draftContent,
            draftUpdatedAt: result.draftUpdatedAt ?? null,
            qualityReport: result.qualityReport,
        });
        toast.success("Version restored to draft");
        invalidateDraftReadme();
        return {
            qualityReport: result.qualityReport,
            draftUpdatedAt: result.draftUpdatedAt ?? null,
            serverDraftContent: result.draftContent,
        };
    }, [invalidateDraftReadme, projectId, updateDraftCache]);

    const handleSetCurrentVersion = useCallback(async (versionId: string) => {
        const result = await setProjectReadmePublishedVersionAction(projectId, versionId);
        if (!result.success) {
            toast.error(result.error);
            return null;
        }
        updateDraftCache({
            draftContent: result.draftContent,
            draftUpdatedAt: result.draftUpdatedAt ?? null,
            publishedVersion: result.version,
            qualityReport: result.qualityReport,
        });
        toast.success("Current README version updated");
        invalidatePublishedReadme();
        invalidateDraftReadme();
        invalidateReadmeVersions();
        return {
            qualityReport: result.qualityReport,
            draftUpdatedAt: result.draftUpdatedAt ?? null,
            serverDraftContent: result.draftContent,
        };
    }, [invalidateDraftReadme, invalidatePublishedReadme, invalidateReadmeVersions, projectId, updateDraftCache]);

    const handleDeleteVersion = useCallback(async (versionId: string) => {
        const result = await deleteProjectReadmeVersionAction(projectId, versionId);
        if (!result.success) {
            toast.error(result.error);
            return null;
        }
        if (result.draftContent != null) {
            updateDraftCache({
                draftContent: result.draftContent,
                draftUpdatedAt: result.draftUpdatedAt ?? null,
                publishedVersion: result.publishedVersion,
                qualityReport: result.qualityReport,
            });
        }
        toast.success("README version deleted");
        invalidateReadmeVersions();
        invalidatePublishedReadme();
        if (result.draftContent != null) invalidateDraftReadme();
        return result.draftContent != null
            ? {
                qualityReport: result.qualityReport,
                draftUpdatedAt: result.draftUpdatedAt ?? null,
                serverDraftContent: result.draftContent,
            }
            : {
                qualityReport: draftQuery.data?.qualityReport ?? { score: 0, issues: [], sectionPresence: {}, contentBytes: 0 },
                draftUpdatedAt: draftQuery.data?.draftUpdatedAt ?? null,
            };
    }, [draftQuery.data?.draftUpdatedAt, draftQuery.data?.qualityReport, invalidateDraftReadme, invalidatePublishedReadme, invalidateReadmeVersions, projectId, updateDraftCache]);

    const handleDiscardDraft = useCallback(async () => {
        const result = await discardProjectReadmeDraftAction(projectId);
        if (!result.success) {
            toast.error(result.error);
            return null;
        }
        updateDraftCache({
            draftContent: result.draftContent,
            draftUpdatedAt: result.draftUpdatedAt ?? null,
            qualityReport: result.qualityReport,
        });
        toast.success("README draft discarded");
        invalidateDraftReadme();
        return {
            qualityReport: result.qualityReport,
            draftUpdatedAt: result.draftUpdatedAt ?? null,
            serverDraftContent: result.draftContent,
        };
    }, [invalidateDraftReadme, projectId, updateDraftCache]);

    const handleImport = useCallback(async (nodeId: string) => {
        setImporting(true);
        try {
            const draft = queryClient.getQueryData<ProjectReadmeDraftPayload | undefined>(PROJECT_README_DRAFT_QUERY_KEY(projectId));
            const result: any = await importProjectReadmeFromFileAction(projectId, {
                nodeId,
                expectedDraftUpdatedAt: draft?.draftUpdatedAt ?? null,
            });
            if (!result.success) {
                if (result.code === "CONFLICT") {
                    toast.error("README draft changed elsewhere. Open the editor and review before importing.");
                } else {
                    toast.error(result.error);
                }
                return;
            }
            updateDraftCache({
                draftContent: result.draftContent,
                draftUpdatedAt: result.draftUpdatedAt ?? null,
                qualityReport: result.qualityReport,
            });
            toast.success(`Imported ${result.sourceFileName}`);
            startEditing();
            invalidateDraftReadme();
        } finally {
            setImporting(false);
        }
    }, [invalidateDraftReadme, projectId, queryClient, startEditing, updateDraftCache]);

    if (readmeQuery.isLoading) return <SkeletonReadme />;
    if (editing && draftQuery.isLoading && readmeQuery.data?.version) {
        return (
            <ProjectReadmeViewer
                project={project}
                payload={readmeQuery.data}
                onEdit={startEditing}
            />
        );
    }
    if (editing && draftQuery.isLoading) return <SkeletonReadme />;
    if (editing && !draftQuery.data) return <SkeletonReadme />;
    if (editing && draftQuery.data) {
        return (
            <ProjectReadmeEditor
                project={project}
                draft={draftQuery.data}
                saving={saving}
                publishing={publishing}
                currentUserName={currentUserName}
                onSave={handleSave}
                onPublish={handlePublish}
                onRestore={handleRestore}
                onDeleteVersion={handleDeleteVersion}
                onSetCurrentVersion={handleSetCurrentVersion}
                onDiscardDraft={handleDiscardDraft}
                onExit={() => setEditing(false)}
            />
        );
    }

    if (readmeQuery.data?.version) {
        return (
            <ProjectReadmeViewer
                project={project}
                payload={readmeQuery.data}
                onEdit={startEditing}
            />
        );
    }

    if (canEdit) {
        return (
            <ProjectReadmeEmptyState
                canEdit={canEdit}
                projectId={projectId}
                importing={importing}
                onCreate={handleCreate}
                onImport={handleImport}
            />
        );
    }

    return (
        <div className="mx-auto max-w-3xl rounded-[2rem] border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <BookOpenText className="mx-auto h-8 w-8 text-zinc-400" />
            <p className="mt-4 text-lg font-semibold text-zinc-950 dark:text-zinc-50">README unavailable</p>
            <p className="mt-2 text-sm leading-6 text-zinc-500">
                This project has not published a README that is visible to you.
            </p>
            {draftQuery.isLoading ? (
                <p className="mt-4 inline-flex items-center gap-2 text-xs text-zinc-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Checking editor access
                </p>
            ) : null}
        </div>
    );
}
