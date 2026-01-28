"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FileText, Link2, Loader2, Paperclip, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { ProjectNode } from "@/lib/db/schema";
import { createFileNode, getProjectNodes, getTaskAttachments, linkNodeToTask, unlinkNodeFromTask } from "@/app/actions/files";

interface FilesTabProps {
    taskId: string;
    isOwnerOrMember: boolean;
    projectId: string;
    taskTitle?: string;
}

function formatBytes(bytes?: number | null) {
    const b = bytes ?? 0;
    if (b < 1024) return `${b} B`;
    const kb = b / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
}

function extOf(name: string) {
    const parts = name.split(".");
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

type PickerState =
    | { open: false }
    | { open: true; query: string; loading: boolean; results: ProjectNode[] };

export default function FilesTab({ taskId, isOwnerOrMember, projectId, taskTitle }: FilesTabProps) {
    const canEdit = isOwnerOrMember;
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [isLoading, setIsLoading] = useState(true);
    const [isUploading, setIsUploading] = useState(false);
    const [attachments, setAttachments] = useState<ProjectNode[]>([]);
    const [error, setError] = useState<string | null>(null);

    const [picker, setPicker] = useState<PickerState>({ open: false });

    const supabase = useMemo(() => createClient(), []);

    const refresh = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const nodes = (await getTaskAttachments(taskId)) as ProjectNode[];
            setAttachments(nodes || []);
        } catch (e: any) {
            setError(e?.message || "Failed to load attachments");
        } finally {
            setIsLoading(false);
        }
    }, [taskId]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const handleUploadAndAttach = useCallback(
        async (file: File) => {
            if (!file) return;
            if (!canEdit) return;
            setIsUploading(true);
            setError(null);

            try {
                const fileExt = extOf(file.name);
                const opaque = Math.random().toString(36).slice(2);
                const storagePath = `projects/${projectId}/${opaque}${fileExt ? `.${fileExt}` : ""}`;

                const { error: uploadError } = await supabase.storage
                    .from("project-files")
                    .upload(storagePath, file, { upsert: false });
                if (uploadError) throw uploadError;

                // Keep it simple: store uploaded files at root. Users can organize later in explorer.
                const node = (await createFileNode(projectId, null, {
                    name: file.name,
                    s3Key: storagePath,
                    size: file.size,
                    mimeType: file.type || "application/octet-stream",
                })) as ProjectNode;

                await linkNodeToTask(taskId, node.id);
                await refresh();
            } catch (e: any) {
                setError(e?.message || "Upload failed");
            } finally {
                setIsUploading(false);
                if (fileInputRef.current) fileInputRef.current.value = "";
            }
        },
        [canEdit, projectId, refresh, supabase.storage, taskId]
    );

    const handleDownload = useCallback(
        async (node: ProjectNode) => {
            if (!node.s3Key) return;
            try {
                const { data, error: urlError } = await supabase.storage
                    .from("project-files")
                    .createSignedUrl(node.s3Key, 3600);
                if (urlError) throw urlError;
                const a = document.createElement("a");
                a.href = data.signedUrl;
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                a.download = node.name;
                a.click();
            } catch (e: any) {
                setError(e?.message || "Failed to create download link");
            }
        },
        [supabase.storage]
    );

    const handleUnlink = useCallback(
        async (nodeId: string) => {
            if (!canEdit) return;
            setError(null);
            try {
                await unlinkNodeFromTask(taskId, nodeId);
                setAttachments((prev) => prev.filter((n) => n.id !== nodeId));
            } catch (e: any) {
                setError(e?.message || "Failed to unlink");
            }
        },
        [canEdit, taskId]
    );

    const openPicker = useCallback(() => {
        setPicker({ open: true, query: "", loading: false, results: [] });
    }, []);

    const closePicker = useCallback(() => {
        setPicker({ open: false });
    }, []);

    const runPickerSearch = useCallback(
        async (query: string) => {
            setPicker((p) => (p.open ? { ...p, query, loading: true } : p));
            try {
                const nodes = (await getProjectNodes(projectId, null, query)) as ProjectNode[];
                const files = (nodes || []).filter((n) => n.type === "file");
                setPicker((p) => (p.open ? { ...p, loading: false, results: files } : p));
            } catch {
                setPicker((p) => (p.open ? { ...p, loading: false, results: [] } : p));
            }
        },
        [projectId]
    );

    const attachExisting = useCallback(
        async (nodeId: string) => {
            if (!canEdit) return;
            setError(null);
            try {
                await linkNodeToTask(taskId, nodeId);
                await refresh();
                closePicker();
            } catch (e: any) {
                setError(e?.message || "Failed to attach");
            }
        },
        [canEdit, closePicker, refresh, taskId]
    );

    const headerSubtitle = useMemo(() => {
        const base = `${attachments.length} attachment${attachments.length === 1 ? "" : "s"}`;
        return taskTitle ? `${base} • ${taskTitle}` : base;
    }, [attachments.length, taskTitle]);

    if (isLoading) {
        return (
            <div className="p-6 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
            </div>
        );
    }

    return (
        <div className="p-6 space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <Paperclip className="w-4 h-4 text-zinc-400" />
                        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Attachments</h3>
                    </div>
                    <p className="text-xs text-zinc-500 mt-1 truncate">{headerSubtitle}</p>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                    <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void handleUploadAndAttach(f);
                        }}
                        disabled={!canEdit || isUploading}
                        id="task-attach-upload"
                    />
                    <label
                        htmlFor="task-attach-upload"
                        className={[
                            "inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                            canEdit
                                ? "bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer"
                                : "bg-zinc-200 text-zinc-500 cursor-not-allowed dark:bg-zinc-800 dark:text-zinc-400",
                        ].join(" ")}
                        title={canEdit ? "Upload and attach" : "No permission"}
                    >
                        {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        Upload
                    </label>

                    <button
                        type="button"
                        onClick={openPicker}
                        disabled={!canEdit}
                        className={[
                            "inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors",
                            canEdit
                                ? "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                                : "border-zinc-200 text-zinc-400 cursor-not-allowed dark:border-zinc-800",
                        ].join(" ")}
                    >
                        <Plus className="w-4 h-4" />
                        Attach existing
                    </button>
                </div>
            </div>

            {error ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
                    {error}
                </div>
            ) : null}

            {/* List */}
            {attachments.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 p-8 text-center bg-zinc-50/50 dark:bg-zinc-900/40">
                    <FileText className="w-10 h-10 mx-auto text-zinc-300 dark:text-zinc-700 mb-3" />
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">No attachments</div>
                    <div className="text-xs text-zinc-500 mt-1">Upload a file or attach an existing project file.</div>
                </div>
            ) : (
                <div className="space-y-2">
                    {attachments.map((node) => (
                        <div
                            key={node.id}
                            className="flex items-center justify-between gap-3 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:shadow-sm transition-shadow"
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-9 h-9 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center flex-shrink-0">
                                    <FileText className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                                </div>
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                                            {node.name}
                                        </div>
                                        <span className="text-[10px] text-zinc-400 flex-shrink-0">
                                            {extOf(node.name) ? `.${extOf(node.name)}` : ""}
                                        </span>
                                    </div>
                                    <div className="text-xs text-zinc-500 flex items-center gap-2">
                                        <span>{formatBytes(node.size)}</span>
                                        {node.mimeType ? (
                                            <>
                                                <span>•</span>
                                                <span className="truncate max-w-[220px]">{node.mimeType}</span>
                                            </>
                                        ) : null}
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-1 flex-shrink-0">
                                <button
                                    type="button"
                                    onClick={() => void handleDownload(node)}
                                    disabled={!canEdit}
                                    className={[
                                        "p-2 rounded-lg transition-colors",
                                        canEdit
                                            ? "text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
                                            : "text-zinc-300 cursor-not-allowed dark:text-zinc-600",
                                    ].join(" ")}
                                    title={canEdit ? "Download" : "Preview only"}
                                >
                                    <Download className="w-4 h-4" />
                                </button>

                                <button
                                    type="button"
                                    onClick={() => void handleUnlink(node.id)}
                                    disabled={!canEdit}
                                    className={[
                                        "p-2 rounded-lg transition-colors",
                                        canEdit
                                            ? "text-zinc-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                                            : "text-zinc-300 cursor-not-allowed dark:text-zinc-600",
                                    ].join(" ")}
                                    title={canEdit ? "Unlink from task" : "No permission"}
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Attach existing picker */}
            {picker.open ? (
                <div className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-black/50">
                    <div className="w-full max-w-2xl rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
                            <div className="flex items-center gap-2">
                                <Link2 className="w-4 h-4 text-zinc-400" />
                                <div className="text-sm font-semibold">Attach existing file</div>
                            </div>
                            <button
                                type="button"
                                className="p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                onClick={closePicker}
                                aria-label="Close"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="p-4 space-y-3">
                            <div className="relative">
                                <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                <input
                                    autoFocus
                                    value={picker.query}
                                    onChange={(e) => {
                                        const q = e.target.value;
                                        setPicker((p) => (p.open ? { ...p, query: q } : p));
                                        void runPickerSearch(q.trim());
                                    }}
                                    placeholder="Search project files by name…"
                                    className="w-full h-10 pl-9 pr-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm outline-none"
                                />
                            </div>

                            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden max-h-[50vh] overflow-y-auto">
                                {picker.loading ? (
                                    <div className="p-4 text-sm text-zinc-500 flex items-center gap-2">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Searching…
                                    </div>
                                ) : picker.results.length === 0 ? (
                                    <div className="p-4 text-sm text-zinc-500">No matches</div>
                                ) : (
                                    <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                                        {picker.results.map((n) => (
                                            <div key={n.id} className="flex items-center justify-between gap-3 px-4 py-3">
                                                <div className="min-w-0">
                                                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                                        {n.name}
                                                    </div>
                                                    <div className="text-xs text-zinc-500">{formatBytes(n.size)}</div>
                                                </div>
                                                <button
                                                    type="button"
                                                    disabled={!canEdit}
                                                    onClick={() => void attachExisting(n.id)}
                                                    className={[
                                                        "inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                                                        canEdit
                                                            ? "bg-indigo-600 text-white hover:bg-indigo-700"
                                                            : "bg-zinc-200 text-zinc-500 cursor-not-allowed dark:bg-zinc-800 dark:text-zinc-400",
                                                    ].join(" ")}
                                                >
                                                    <Plus className="w-4 h-4" />
                                                    Attach
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
