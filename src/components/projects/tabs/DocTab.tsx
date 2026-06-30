"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { BookOpenText, Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";

import {
    deleteProjectDocVersionAction,
    discardProjectDocDraftAction,
    importProjectDocFromFileAction,
    publishProjectDocAction,
    readProjectDocDraftAction,
    restoreProjectDocVersionAction,
    saveProjectDocDraftAction,
    setProjectDocPublishedVersionAction,
} from "@/app/actions/project";
import { ProjectDocEmptyState } from "@/components/projects/doc/ProjectDocEmptyState";
import { ProjectDocViewer } from "@/components/projects/doc/ProjectDocViewer";
import { SkeletonDoc } from "@/components/projects/skeletons/SkeletonDoc";
import {
    PROJECT_DOC_DRAFT_QUERY_KEY,
    PROJECT_DOC_QUERY_KEY,
    PROJECT_DOC_VERSIONS_QUERY_KEY,
    useProjectDoc,
    useProjectDocDraft,
} from "@/hooks/hub/useProjectDocData";
import { normalizeProjectDocSlug, type ProjectDocDraftPayload, type ProjectDocQualityReport } from "@/lib/projects/doc";
import type { Project } from "@/types/hub";

const ProjectDocEditor = dynamic(
    () => import("@/components/projects/doc/ProjectDocEditor").then((mod) => ({ default: mod.ProjectDocEditor })),
    { loading: () => <SkeletonDoc />, ssr: false },
);

export default function DocTab({
    projectId,
    project,
    currentUserId,
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
    const searchParams = useSearchParams();
    const rawDocSlug = searchParams?.get("doc") || "readme";
    const docSlug = useMemo(() => normalizeProjectDocSlug(rawDocSlug), [rawDocSlug]);

    const queryClient = useQueryClient();
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [importing, setImporting] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const readmeQuery = useProjectDoc(projectId, docSlug);
    const canEdit = Boolean(readmeQuery.data?.canEdit);
    const draftQuery = useProjectDocDraft(projectId, docSlug, editing);

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
        void queryClient.invalidateQueries({ queryKey: PROJECT_DOC_QUERY_KEY(projectId, docSlug) });
    }, [projectId, docSlug, queryClient]);

    const invalidateDraftReadme = useCallback(() => {
        void queryClient.invalidateQueries({ queryKey: PROJECT_DOC_DRAFT_QUERY_KEY(projectId, docSlug) });
    }, [projectId, docSlug, queryClient]);

    const invalidateReadmeVersions = useCallback(() => {
        void queryClient.invalidateQueries({ queryKey: PROJECT_DOC_VERSIONS_QUERY_KEY(projectId, docSlug) });
    }, [projectId, docSlug, queryClient]);

    const updateDraftCache = useCallback((patch: Partial<ProjectDocDraftPayload>) => {
        queryClient.setQueryData<ProjectDocDraftPayload | undefined>(
            PROJECT_DOC_DRAFT_QUERY_KEY(projectId, docSlug),
            (current) => current ? { ...current, ...patch } : current,
        );
    }, [projectId, docSlug, queryClient]);

    useEffect(() => {
        if (!canEdit || typeof window === "undefined") return;
        const timer = window.setTimeout(() => {
            (ProjectDocEditor as unknown as { preload?: () => void }).preload?.();
            void queryClient.prefetchQuery({
                queryKey: PROJECT_DOC_DRAFT_QUERY_KEY(projectId, docSlug),
                queryFn: async () => {
                    const result = await readProjectDocDraftAction(projectId, docSlug);
                    if (!result.success) throw new Error(result.error);
                    return result.data;
                },
                staleTime: 1000 * 60,
            });
        }, 400);
        return () => window.clearTimeout(timer);
    }, [canEdit, projectId, docSlug, queryClient]);

    const startEditing = useCallback(() => {
        (ProjectDocEditor as unknown as { preload?: () => void }).preload?.();
        setEditing(true);
    }, []);

    const handleCreate = useCallback(() => {
        const title = docSlug === "readme" ? (project.title || "Project Document") : docSlug.toUpperCase();
        const content = `# ${title}\n\n`;
        startEditing();
        window.setTimeout(() => {
            void saveProjectDocDraftAction(projectId, { content, docSlug }).then((result) => {
                if (!result.success) toast.error(result.error);
                if (result.success) {
                    updateDraftCache({
                        draftContent: result.draftContent ?? content,
                        draftUpdatedAt: result.draftUpdatedAt ?? null,
                        qualityReport: result.qualityReport,
                    });
                }
                invalidateDraftReadme();
            });
        }, 0);
    }, [invalidateDraftReadme, project.title, projectId, docSlug, startEditing, updateDraftCache]);

    const handleSave = useCallback(async (content: string, expectedDraftUpdatedAt: string | null): Promise<{
        qualityReport: ProjectDocQualityReport;
        draftUpdatedAt: string | null;
        conflict?: boolean;
        serverDraftContent?: string;
    } | null> => {
        setSaving(true);
        try {
            const result: any = await saveProjectDocDraftAction(projectId, { content, docSlug, expectedDraftUpdatedAt });
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
            const savedContent = result.draftContent ?? content;
            updateDraftCache({
                draftContent: savedContent,
                draftUpdatedAt: result.draftUpdatedAt ?? null,
                qualityReport: result.qualityReport,
            });
            return {
                qualityReport: result.qualityReport,
                draftUpdatedAt: result.draftUpdatedAt ?? null,
                serverDraftContent: savedContent,
            };
        } finally {
            setSaving(false);
        }
    }, [projectId, docSlug, updateDraftCache]);

    const handlePublish = useCallback(async (content: string, expectedDraftUpdatedAt: string | null, changeSummary: string, syncToFilesTab: boolean) => {
        setPublishing(true);
        try {
            const result = await publishProjectDocAction(projectId, { content, docSlug, expectedDraftUpdatedAt, changeSummary, syncToFilesTab });
            if (!result.success) {
                if ("code" in result && result.code === "CONFLICT") {
                    toast.error("Document changed elsewhere. Review the latest draft before publishing.");
                } else {
                    toast.error(result.error);
                }
                return false;
            }
            toast.success("Document published");
            setEditing(false);
            invalidatePublishedReadme();
            invalidateDraftReadme();
            invalidateReadmeVersions();
            return true;
        } finally {
            setPublishing(false);
        }
    }, [invalidateDraftReadme, invalidatePublishedReadme, invalidateReadmeVersions, projectId, docSlug]);

    const handleRestore = useCallback(async (versionId: string) => {
        const result = await restoreProjectDocVersionAction(projectId, versionId, docSlug);
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
    }, [invalidateDraftReadme, projectId, docSlug, updateDraftCache]);

    const handleSetCurrentVersion = useCallback(async (versionId: string) => {
        const result = await setProjectDocPublishedVersionAction(projectId, versionId, docSlug);
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
        toast.success("Current version updated");
        invalidatePublishedReadme();
        invalidateDraftReadme();
        invalidateReadmeVersions();
        return {
            qualityReport: result.qualityReport,
            draftUpdatedAt: result.draftUpdatedAt ?? null,
            serverDraftContent: result.draftContent,
        };
    }, [invalidateDraftReadme, invalidatePublishedReadme, invalidateReadmeVersions, projectId, docSlug, updateDraftCache]);

    const handleDeleteVersion = useCallback(async (versionId: string) => {
        const result = await deleteProjectDocVersionAction(projectId, versionId, docSlug);
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
        toast.success("Version deleted");
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
    }, [draftQuery.data?.draftUpdatedAt, draftQuery.data?.qualityReport, invalidateDraftReadme, invalidatePublishedReadme, invalidateReadmeVersions, projectId, docSlug, updateDraftCache]);

    const handleDiscardDraft = useCallback(async () => {
        const result = await discardProjectDocDraftAction(projectId, docSlug);
        if (!result.success) {
            toast.error(result.error);
            return null;
        }
        updateDraftCache({
            draftContent: result.draftContent,
            draftUpdatedAt: result.draftUpdatedAt ?? null,
            qualityReport: result.qualityReport,
        });
        toast.success("Draft discarded");
        invalidateDraftReadme();
        return {
            qualityReport: result.qualityReport,
            draftUpdatedAt: result.draftUpdatedAt ?? null,
            serverDraftContent: result.draftContent,
        };
    }, [invalidateDraftReadme, projectId, docSlug, updateDraftCache]);

    const handleImport = useCallback(async (nodeId: string) => {
        setImporting(true);
        try {
            const draft = queryClient.getQueryData<ProjectDocDraftPayload | undefined>(PROJECT_DOC_DRAFT_QUERY_KEY(projectId, docSlug));
            const result: any = await importProjectDocFromFileAction(projectId, {
                nodeId,
                docSlug,
                expectedDraftUpdatedAt: draft?.draftUpdatedAt ?? null,
            });
            if (!result.success) {
                if (result.code === "CONFLICT") {
                    toast.error("Draft changed elsewhere. Open the editor and review before importing.");
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
    }, [invalidateDraftReadme, projectId, docSlug, queryClient, startEditing, updateDraftCache]);

    if (readmeQuery.isLoading) return <SkeletonDoc />;
    if (editing && draftQuery.isLoading && readmeQuery.data?.version) {
        return (
            <ProjectDocViewer
                key={`${projectId}:${docSlug}:loading-viewer`}
                project={project}
                payload={readmeQuery.data}
                docSlug={docSlug}
                onEdit={startEditing}
            />
        );
    }
    if (editing && draftQuery.isLoading) return <SkeletonDoc />;
    if (editing && !draftQuery.data) return <SkeletonDoc />;
    if (editing && draftQuery.data) {
        return (
            <ProjectDocEditor
                key={`${projectId}:${docSlug}:editor`}
                project={project}
                draft={draftQuery.data}
                saving={saving}
                publishing={publishing}
                currentUserId={currentUserId}
                currentUserName={currentUserName}
                docSlug={docSlug}
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
            <ProjectDocViewer
                key={`${projectId}:${docSlug}:${readmeQuery.data.version.id}`}
                project={project}
                payload={readmeQuery.data}
                docSlug={docSlug}
                onEdit={startEditing}
            />
        );
    }

    if (canEdit) {
        return (
            <ProjectDocEmptyState
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
            <p className="mt-4 text-lg font-semibold text-zinc-950 dark:text-zinc-50">
                {docSlug === "readme" ? "Document unavailable" : "Document unavailable"}
            </p>
            <p className="mt-2 text-sm leading-6 text-zinc-500">
                {docSlug === "readme"
                    ? "This project has not published a document that is visible to you."
                    : "This project has not published a document that is visible to you."}
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
