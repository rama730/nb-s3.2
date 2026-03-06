"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FileText, Folder, Link2, Loader2, Paperclip, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { ProjectNode } from "@/lib/db/schema";
import { createFileNode, getProjectNodes, getTaskAttachments, linkNodeToTask, unlinkNodeFromTask, getProjectRecentNodes } from "@/app/actions/files";
import { TaskFilesExplorer } from "@/components/projects/v2/tasks/components/TaskFilesExplorer";
import { buildProjectFileKey } from "@/lib/storage/project-file-key";

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

function appendUploadSuffix(filename: string, suffix: number) {
    const idx = filename.lastIndexOf(".");
    if (idx <= 0) return `${filename}-${suffix}`;
    return `${filename.slice(0, idx)}-${suffix}${filename.slice(idx)}`;
}

type PickerState =
    | { open: false }
    | { open: true; query: string; loading: boolean; results: ProjectNode[]; suggestions?: ProjectNode[] };

type UploadStatus = { id: string; filename: string; progress: number; status: 'uploading' | 'success' | 'error'; error?: string };

export default function FilesTab({ taskId, isOwnerOrMember, projectId, taskTitle }: FilesTabProps) {
    const canEdit = isOwnerOrMember;
    const fileInputRef = useRef<HTMLInputElement>(null);
    const pickerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [isLoading, setIsLoading] = useState(true);
    const [uploadQueue, setUploadQueue] = useState<UploadStatus[]>([]);
    const isUploading = uploadQueue.some(item => item.status === 'uploading');
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
        async (files: File[]) => {
            if (!files.length || !canEdit) return;
            setError(null);

            // Create upload jobs with unique IDs
            const jobs = files.map(f => ({
                id: Math.random().toString(36).substring(2, 9),
                file: f
            }));

            // Initialize queue
            const newQueue: UploadStatus[] = jobs.map(j => ({
                id: j.id,
                filename: j.file.name,
                progress: 0,
                status: 'uploading'
            }));
            setUploadQueue(prev => [...prev, ...newQueue]);

            const processFile = async ({ id, file }: { id: string, file: File }) => {
                const updateStatus = (updates: Partial<UploadStatus>) => {
                    setUploadQueue(prev => prev.map(item => 
                        item.id === id && item.status === 'uploading' 
                            ? { ...item, ...updates } 
                            : item
                    ));
                };
                let storagePath: string | null = null;
                let createdNode: ProjectNode | null = null;

                try {
                    const fileExt = extOf(file.name);
                    const opaque = Math.random().toString(36).slice(2);
                    storagePath = buildProjectFileKey(projectId, `${opaque}${fileExt ? `.${fileExt}` : ""}`);

                    updateStatus({ progress: 20 });

                    const { error: uploadError } = await supabase.storage
                        .from("project-files")
                        .upload(storagePath, file, { upsert: false });
                    
                    if (uploadError) throw uploadError;
                    updateStatus({ progress: 60 });

                    let candidateName = file.name;
                    
                    for (let attempt = 0; attempt < 5; attempt++) {
                        try {
                            createdNode = (await createFileNode(projectId, null, {
                                name: candidateName,
                                s3Key: storagePath,
                                size: file.size,
                                mimeType: file.type || "application/octet-stream",
                            })) as ProjectNode;
                            break;
                        } catch (e: any) {
                            if (typeof e?.message === "string" && e.message.includes("already exists in this location")) {
                                candidateName = appendUploadSuffix(file.name, attempt + 1);
                                continue;
                            }
                            throw e;
                        }
                    }
                    
                    if (!createdNode) throw new Error("Failed to create attachment record");
                    updateStatus({ progress: 80 });
                    
                    await linkNodeToTask(taskId, createdNode.id);
                    updateStatus({ progress: 100, status: 'success' });
                    
                } catch (e: any) {
                    if (!createdNode && storagePath) {
                        await supabase.storage.from("project-files").remove([storagePath]).catch(() => null);
                    }
                    updateStatus({ status: 'error', error: e?.message || "Upload failed" });
                    throw e; 
                }
            };

            try {
                // Pure Optimization: process files in bounded chunks (max 3 at a time) to prevent connection pool exhaustion and browser overload
                const CONCURRENCY = 3;
                for (let i = 0; i < jobs.length; i += CONCURRENCY) {
                    const chunk = jobs.slice(i, i + CONCURRENCY);
                    await Promise.allSettled(chunk.map(processFile));
                }
                await refresh();
            } finally {
                // Clear successful uploads after a short delay
                setTimeout(() => {
                    setUploadQueue(prev => prev.filter(item => item.status !== 'success'));
                }, 3000);
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
                a.href = data.url;
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

    const openPicker = useCallback(async () => {
        setPicker({ open: true, query: "", loading: true, results: [], suggestions: [] });
        try {
            const recent = await getProjectRecentNodes(projectId, 5);
            setPicker(p => p.open ? { ...p, loading: false, suggestions: recent } : p);
        } catch {
            setPicker(p => p.open ? { ...p, loading: false } : p);
        }
    }, [projectId]);

    const closePicker = useCallback(() => {
        setPicker({ open: false });
    }, []);

    const runPickerSearch = useCallback(
        async (query: string) => {
            if (!query) {
                setPicker((p) => (p.open ? { ...p, query, results: [] } : p));
                return;
            }
            setPicker((p) => (p.open ? { ...p, query, loading: true } : p));
            try {
                const res = await getProjectNodes(projectId, null, query);
                const nodes = Array.isArray(res) ? res : res.nodes;
                const validNodes = (nodes || []).filter((n) => n.type === "file" || n.type === "folder");
                setPicker((p) => (p.open ? { ...p, loading: false, results: validNodes } : p));
            } catch {
                setPicker((p) => (p.open ? { ...p, loading: false, results: [] } : p));
            }
        },
        [projectId]
    );

    const attachExisting = useCallback(
        async (nodeId: string) => {
            if (!canEdit) return;
            if (attachments.some((a) => a.id === nodeId)) {
                closePicker();
                return;
            }
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

    useEffect(() => {
        return () => {
            if (pickerTimerRef.current) clearTimeout(pickerTimerRef.current);
        };
    }, []);

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
                        multiple
                        className="hidden"
                        onChange={(e) => {
                            const incoming = Array.from(e.target.files || []);
                            if (incoming.length > 0) void handleUploadAndAttach(incoming);
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

            {/* Upload Queue View */}
            {uploadQueue.length > 0 && (
                <div className="flex flex-col gap-2 mt-2">
                    {uploadQueue.map((item) => (
                        <div key={item.id} className="flex items-center justify-between p-2 rounded border bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700">
                            <div className="flex flex-col min-w-0 pr-4 flex-1">
                                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{item.filename}</span>
                                {item.status === 'error' && item.error ? (
                                    <span className="text-xs text-red-500 truncate">{item.error}</span>
                                ) : (
                                    <span className="text-xs text-zinc-500 mt-1">
                                        {item.status === 'success' ? 'Uploaded' : `${item.progress}%`}
                                    </span>
                                )}
                            </div>
                            
                            {item.status === 'uploading' && (
                                <div className="w-24 h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden shrink-0">
                                    <div 
                                        className="h-full bg-indigo-600 transition-all duration-300"
                                        style={{ width: `${item.progress}%` }}
                                    />
                                </div>
                            )}
                            {item.status === 'success' && <div className="w-4 h-4 rounded-full bg-green-500 shrink-0" />}
                            {item.status === 'error' && <div className="w-4 h-4 rounded-full bg-red-500 shrink-0" />}
                        </div>
                    ))}
                </div>
            )}

            {error ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
                    {error}
                </div>
            ) : null}

            {/* List */}
            <div className="flex-1 min-h-[300px] flex flex-col">
                <TaskFilesExplorer 
                    taskId={taskId}
                    projectId={projectId}
                    linkedNodes={attachments}
                    canEdit={canEdit}
                    onUnlink={handleUnlink}
                    onOpenFile={(node) => void handleDownload(node)}
                    onReorder={(newOrderIds) => {
                        const newNodes = newOrderIds.map(id => attachments.find(a => a.id === id)).filter(Boolean) as ProjectNode[];
                        setAttachments(newNodes);
                    }}
                />
            </div>

            {/* Attach existing picker */}
            {picker.open ? (
                <div className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-black/50">
                    <div className="w-full max-w-2xl rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
                            <div className="flex items-center gap-2">
                                <Link2 className="w-4 h-4 text-zinc-400" />
                                <div className="text-sm font-semibold">Attach existing file or folder</div>
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
                                        if (pickerTimerRef.current) clearTimeout(pickerTimerRef.current);
                                        pickerTimerRef.current = setTimeout(() => {
                                            void runPickerSearch(q.trim());
                                        }, 180);
                                    }}
                                    placeholder="Search project files/folders by name…"
                                    className="w-full h-10 pl-9 pr-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm outline-none"
                                />
                            </div>

                            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden max-h-[50vh] overflow-y-auto">
                                {picker.loading ? (
                                    <div className="p-4 text-sm text-zinc-500 flex items-center gap-2">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Searching…
                                    </div>
                                ) : !picker.query && picker.suggestions && picker.suggestions.length > 0 ? (
                                    // 4e. Smart Suggestions Default View
                                    <div className="p-2 space-y-1">
                                        <div className="px-3 py-2 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                                            Recently Updated Files
                                        </div>
                                        {picker.suggestions.map((n: ProjectNode) => (
                                            <div key={n.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                                                <div className="min-w-0">
                                                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate flex items-center gap-2">
                                                        <FileText className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                                                        {n.name}
                                                    </div>
                                                    <div className="text-xs text-zinc-500 mt-0.5">
                                                        {formatBytes(n.size)} • Modified {new Date(n.updatedAt!).toLocaleDateString()}
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    disabled={!canEdit || attachments.some((a) => a.id === n.id)}
                                                    onClick={() => void attachExisting(n.id)}
                                                    className={[
                                                        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors border",
                                                        canEdit && !attachments.some((a) => a.id === n.id)
                                                            ? "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                                                            : "bg-zinc-100 border-transparent text-zinc-400 cursor-not-allowed dark:bg-zinc-800/50",
                                                    ].join(" ")}
                                                >
                                                    {attachments.some((a) => a.id === n.id) ? (
                                                        <span className="text-emerald-600 dark:text-emerald-500">Attached</span>
                                                    ) : (
                                                        <>
                                                            <Plus className="w-3.5 h-3.5" />
                                                            Attach
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                ) : picker.query && picker.results.length === 0 ? (
                                    <div className="p-4 text-sm text-zinc-500">No matches found for &quot;{picker.query}&quot;</div>
                                ) : picker.query ? (
                                    <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                                        <div className="px-5 py-2 text-xs font-semibold text-zinc-500 bg-zinc-50 dark:bg-zinc-900/50">Search Results</div>
                                        {picker.results.map((n) => (
                                            <div key={n.id} className="flex items-center justify-between gap-3 px-4 py-3">
                                                <div className="min-w-0">
                                                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate flex items-center gap-2">
                                                        {n.type === "folder" ? (
                                                            <Folder className="w-4 h-4 text-blue-500 flex-shrink-0" />
                                                        ) : (
                                                            <FileText className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                                                        )}
                                                        {n.name}
                                                    </div>
                                                    <div className="text-xs text-zinc-500 mt-0.5">
                                                        {n.type === "folder" ? "Folder" : formatBytes(n.size)}
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    disabled={!canEdit || attachments.some((a) => a.id === n.id)}
                                                    onClick={() => void attachExisting(n.id)}
                                                    className={[
                                                        "inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors border",
                                                        canEdit && !attachments.some((a) => a.id === n.id)
                                                            ? "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                                                            : "bg-zinc-100 border-transparent text-zinc-400 cursor-not-allowed dark:bg-zinc-800/50",
                                                    ].join(" ")}
                                                >
                                                    {attachments.some((a) => a.id === n.id) ? (
                                                        <span className="text-emerald-600 dark:text-emerald-500">Attached</span>
                                                    ) : (
                                                        <>
                                                            <Plus className="w-4 h-4" />
                                                            Attach
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="p-8 text-center text-zinc-500 text-sm">
                                        Search for files or select from recent suggestions above.
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
