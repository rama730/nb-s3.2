"use client";

import React, { useState, useCallback, useTransition } from "react";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { cn } from "@/lib/utils";
import { filesFeatureFlags } from "@/lib/features/files";
import {
    GitBranch,
    FileText,
    Plus,
    Minus,
    Edit3,
    RefreshCw,
    Upload,
    Download,
    Link2,
    Unlink,
    ChevronDown,
    ChevronRight,
    Clock,
    CheckCircle2,
    Loader2,
    History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui-custom/Toast";
import {
    connectGitHubRepo,
    disconnectGitHubRepo,
    getGitStatus,
    pushToGitHub,
    pullFromGitHub,
    getGitBranches,
    getGitSyncHistory,
} from "@/app/actions/git";

const EMPTY_OBJ = {};


type SyncEvent = {
    id: string;
    type: string;
    actorId: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
};

function StatusDot({ status }: { status: "synced" | "changes" | "syncing" | "disconnected" }) {
    const colors = {
        synced: "bg-emerald-500",
        changes: "bg-amber-500",
        syncing: "bg-blue-500 animate-pulse",
        disconnected: "bg-zinc-400",
    };
    return <span className={cn("inline-block w-2 h-2 rounded-full", colors[status])} />;
}

function FileStatusBadge({ status }: { status: "modified" | "added" | "deleted" }) {
    const map = {
        modified: { label: "M", className: "text-amber-600 dark:text-amber-400" },
        added: { label: "A", className: "text-emerald-600 dark:text-emerald-400" },
        deleted: { label: "D", className: "text-red-600 dark:text-red-400" },
    };
    const { label, className } = map[status];
    return <span className={cn("text-[10px] font-mono font-semibold w-4 text-center", className)}>{label}</span>;
}

function FileStatusIcon({ status }: { status: "modified" | "added" | "deleted" }) {
    const cls = "w-3.5 h-3.5 flex-shrink-0";
    switch (status) {
        case "added":
            return <Plus className={cn(cls, "text-emerald-500")} />;
        case "deleted":
            return <Minus className={cn(cls, "text-red-500")} />;
        default:
            return <Edit3 className={cn(cls, "text-amber-500")} />;
    }
}

export default function SourceControlPanel({
    projectId,
    className,
}: {
    projectId: string;
    className?: string;
}) {
    if (!filesFeatureFlags.wave4GitIntegration) {
        return <FallbackPanel projectId={projectId} className={className} />;
    }

    return <GitIntegrationPanel projectId={projectId} className={className} />;
}

function FallbackPanel({ projectId, className }: { projectId: string; className?: string }) {
    const fileStates = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.fileStates || EMPTY_OBJ);
    const nodesById = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.nodesById || EMPTY_OBJ);
    const openTab = useFilesWorkspaceStore((s) => s.openTab);

    const dirtyFiles = Object.entries(fileStates)
        .filter(([, state]) => state.isDirty)
        .map(([id]) => nodesById[id])
        .filter(Boolean);

    if (dirtyFiles.length === 0) {
        return (
            <div className={cn("p-4 text-xs text-zinc-400 italic text-center", className)}>
                No changed files
            </div>
        );
    }

    return (
        <div className={cn("flex flex-col py-2", className)}>
            {dirtyFiles.map((node) => (
                <div
                    key={node.id}
                    className="flex items-center gap-2 px-3 py-1 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs group"
                    onClick={() => openTab(projectId, "left", node.id)}
                    title={node.name}
                >
                    <FileText className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                    <span className="truncate flex-1 text-amber-700 dark:text-amber-400">{node.name}</span>
                    <span className="text-[10px] text-zinc-400 opacity-60">M</span>
                </div>
            ))}
        </div>
    );
}

function GitIntegrationPanel({ projectId, className }: { projectId: string; className?: string }) {
    const { showToast } = useToast();
    const git = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.git);
    const setGitRepo = useFilesWorkspaceStore((s) => s.setGitRepo);
    const setGitSyncStatus = useFilesWorkspaceStore((s) => s.setGitSyncStatus);
    const setGitChangedFiles = useFilesWorkspaceStore((s) => s.setGitChangedFiles);
    const setGitCommitMessage = useFilesWorkspaceStore((s) => s.setGitCommitMessage);
    const setGitBranches = useFilesWorkspaceStore((s) => s.setGitBranches);
    const setGitLastSync = useFilesWorkspaceStore((s) => s.setGitLastSync);
    const setGitStatusLoaded = useFilesWorkspaceStore((s) => s.setGitStatusLoaded);
    const clearGitState = useFilesWorkspaceStore((s) => s.clearGitState);
    const openTab = useFilesWorkspaceStore((s) => s.openTab);

    const [isPending, startTransition] = useTransition();
    const [repoUrlInput, setRepoUrlInput] = useState("");
    const [branchInput, setBranchInput] = useState("main");
    const [historyOpen, setHistoryOpen] = useState(false);
    const [syncHistory, setSyncHistory] = useState<SyncEvent[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);

    const gitStatusLoaded = git?.gitStatusLoaded ?? false;
    const connected = !!git?.repoUrl;
    const syncing = git?.syncInProgress ?? false;
    const changedFiles = git?.changedFiles ?? [];
    const commitMessage = git?.commitMessage ?? "";

    const syncStatus: "synced" | "changes" | "syncing" | "disconnected" = syncing
        ? "syncing"
        : !connected
          ? "disconnected"
          : changedFiles.length > 0
            ? "changes"
            : "synced";

    const loadStatus = useCallback(() => {
        startTransition(async () => {
            try {
                const status = await getGitStatus(projectId);
                if (status.connected && status.repoUrl) {
                    setGitRepo(projectId, status.repoUrl, status.branch ?? "main");
                    setGitChangedFiles(
                        projectId,
                        status.changedFiles.map((f) => ({
                            nodeId: f.nodeId,
                            status: f.status as "modified" | "added" | "deleted",
                        })),
                    );
                    if (status.lastSyncAt && status.lastCommitSha) {
                        setGitLastSync(projectId, status.lastSyncAt, status.lastCommitSha);
                    }
                }
                setGitStatusLoaded(projectId, true);
            } catch {
                setGitStatusLoaded(projectId, true);
            }
        });
    }, [projectId, setGitRepo, setGitChangedFiles, setGitLastSync, setGitStatusLoaded, startTransition]);

    const handleConnect = useCallback(() => {
        if (!repoUrlInput.trim()) return;
        startTransition(async () => {
            const result = await connectGitHubRepo(projectId, repoUrlInput.trim(), branchInput.trim() || undefined);
            if (result.success) {
                setGitRepo(projectId, repoUrlInput.trim(), branchInput.trim() || "main");
                showToast("Repository connected", "success");
                setRepoUrlInput("");
                loadStatus();
            } else {
                showToast(result.error ?? "Failed to connect", "error");
            }
        });
    }, [projectId, repoUrlInput, branchInput, setGitRepo, showToast, loadStatus, startTransition]);

    const handleDisconnect = useCallback(() => {
        startTransition(async () => {
            const result = await disconnectGitHubRepo(projectId);
            if (result.success) {
                clearGitState(projectId);
                showToast("Repository disconnected", "success");
            } else {
                showToast(result.error ?? "Failed to disconnect", "error");
            }
        });
    }, [projectId, clearGitState, showToast, startTransition]);

    const handlePush = useCallback(() => {
        if (!commitMessage.trim()) return;
        startTransition(async () => {
            setGitSyncStatus(projectId, true);
            const result = await pushToGitHub(projectId, commitMessage.trim());
            if (result.success) {
                showToast("Push started. Syncing in background...", "success");
                setGitCommitMessage(projectId, "");
                setTimeout(() => {
                    loadStatus();
                    setGitSyncStatus(projectId, false);
                }, 5000);
            } else {
                showToast(result.error ?? "Push failed", "error");
                setGitSyncStatus(projectId, false);
            }
        });
    }, [projectId, commitMessage, setGitSyncStatus, setGitCommitMessage, showToast, loadStatus, startTransition]);

    const handlePull = useCallback(() => {
        startTransition(async () => {
            setGitSyncStatus(projectId, true);
            const result = await pullFromGitHub(projectId);
            if (result.success) {
                showToast("Pull started. Syncing in background...", "success");
                setTimeout(() => {
                    loadStatus();
                    setGitSyncStatus(projectId, false);
                }, 5000);
            } else {
                showToast(result.error ?? "Pull failed", "error");
                setGitSyncStatus(projectId, false);
            }
        });
    }, [projectId, setGitSyncStatus, showToast, loadStatus, startTransition]);


    const handleToggleHistory = useCallback(() => {
        const next = !historyOpen;
        setHistoryOpen(next);
        if (next && syncHistory.length === 0) {
            setLoadingHistory(true);
            getGitSyncHistory(projectId, 20)
                .then((events) => setSyncHistory(events as SyncEvent[]))
                .catch(() => {})
                .finally(() => setLoadingHistory(false));
        }
    }, [historyOpen, syncHistory.length, projectId]);

    const grouped = {
        modified: changedFiles.filter((f) => f.status === "modified"),
        added: changedFiles.filter((f) => f.status === "added"),
        deleted: changedFiles.filter((f) => f.status === "deleted"),
    };

    if (!gitStatusLoaded) {
        return (
            <div className={cn("flex items-center justify-center p-6", className)}>
                <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
            </div>
        );
    }

    return (
        <div className={cn("flex flex-col text-xs h-full", className)}>
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-200 dark:border-zinc-700">
                <GitBranch className="w-3.5 h-3.5 text-zinc-500" />
                <span className="font-medium text-zinc-700 dark:text-zinc-300 truncate flex-1">
                    {connected ? git?.branch ?? "main" : "Source Control"}
                </span>
                <StatusDot status={syncStatus} />
                {connected && (
                    <button
                        onClick={loadStatus}
                        disabled={syncing || isPending}
                        className="p-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
                        title="Refresh status"
                    >
                        <RefreshCw className={cn("w-3 h-3 text-zinc-400", (syncing || isPending) && "animate-spin")} />
                    </button>
                )}
            </div>

            <div className="flex-1 overflow-y-auto">
                {!connected ? (
                    /* Connect Section */
                    <div className="p-3 space-y-3">
                        <p className="text-zinc-500 dark:text-zinc-400">
                            Connect a GitHub repository to push and pull code.
                        </p>
                        <div className="space-y-2">
                            <label className="text-[10px] uppercase font-semibold text-zinc-400 tracking-wider">
                                Repository URL
                            </label>
                            <input
                                type="url"
                                value={repoUrlInput}
                                onChange={(e) => setRepoUrlInput(e.target.value)}
                                placeholder="https://github.com/owner/repo"
                                className="w-full px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] uppercase font-semibold text-zinc-400 tracking-wider">
                                Branch
                            </label>
                            <input
                                type="text"
                                value={branchInput}
                                onChange={(e) => setBranchInput(e.target.value)}
                                placeholder="main"
                                className="w-full px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </div>
                        <Button
                            size="sm"
                            className="w-full text-xs"
                            onClick={handleConnect}
                            disabled={!repoUrlInput.trim() || isPending}
                        >
                            {isPending ? (
                                <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                            ) : (
                                <Link2 className="w-3 h-3 mr-1.5" />
                            )}
                            Connect Repository
                        </Button>
                    </div>
                ) : (
                    <>
                        {/* Connected Repo Info */}
                        <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-700">
                            <div className="flex items-center justify-between">
                                <a
                                    href={git?.repoUrl ?? "#"}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 dark:text-blue-400 hover:underline truncate flex-1"
                                    title={git?.repoUrl ?? ""}
                                >
                                    {git?.repoUrl?.replace("https://github.com/", "") ?? ""}
                                </a>
                                <button
                                    onClick={handleDisconnect}
                                    disabled={syncing || isPending}
                                    className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950 text-red-500 disabled:opacity-40"
                                    title="Disconnect repository"
                                >
                                    <Unlink className="w-3 h-3" />
                                </button>
                            </div>
                            {git?.lastSyncAt && (
                                <div className="flex items-center gap-1 mt-1 text-[10px] text-zinc-400">
                                    <Clock className="w-2.5 h-2.5" />
                                    Last sync: {new Date(git.lastSyncAt).toLocaleString()}
                                </div>
                            )}
                        </div>

                        {/* Changed Files */}
                        {changedFiles.length > 0 ? (
                            <div className="border-b border-zinc-200 dark:border-zinc-700">
                                <div className="px-3 py-1.5 text-[10px] uppercase font-semibold text-zinc-400 tracking-wider">
                                    Changes ({changedFiles.length})
                                </div>
                                {(["modified", "added", "deleted"] as const).map((status) => {
                                    const files = grouped[status];
                                    if (files.length === 0) return null;
                                    return (
                                        <div key={status}>
                                            {files.map((f) => (
                                                <div
                                                    key={f.nodeId}
                                                    className="flex items-center gap-2 px-3 py-1 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 group"
                                                    onClick={() => openTab(projectId, "left", f.nodeId)}
                                                >
                                                    <FileStatusIcon status={f.status} />
                                                    <span className="truncate flex-1 text-zinc-700 dark:text-zinc-300">
                                                        {(f as { name?: string }).name ?? f.nodeId.slice(0, 8)}
                                                    </span>
                                                    <FileStatusBadge status={f.status} />
                                                </div>
                                            ))}
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="px-3 py-4 text-center">
                                <CheckCircle2 className="w-5 h-5 text-emerald-500 mx-auto mb-1" />
                                <p className="text-zinc-400">Everything up to date</p>
                            </div>
                        )}

                        {/* Commit & Push Section */}
                        <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-700 space-y-2">
                            <textarea
                                value={commitMessage}
                                onChange={(e) => setGitCommitMessage(projectId, e.target.value)}
                                placeholder="Describe your changes..."
                                rows={2}
                                className="w-full px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                            <div className="flex gap-2">
                                <Button
                                    size="sm"
                                    className="flex-1 text-xs"
                                    onClick={handlePush}
                                    disabled={!commitMessage.trim() || syncing || isPending}
                                >
                                    {syncing ? (
                                        <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                                    ) : (
                                        <Upload className="w-3 h-3 mr-1.5" />
                                    )}
                                    Commit & Push
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-xs"
                                    onClick={handlePull}
                                    disabled={syncing || isPending}
                                    title="Pull latest from GitHub"
                                >
                                    {syncing ? (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                        <Download className="w-3 h-3" />
                                    )}
                                </Button>
                            </div>
                        </div>

                        {/* Sync History */}
                        <div>
                            <button
                                className="flex items-center gap-1.5 w-full px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                                onClick={handleToggleHistory}
                            >
                                {historyOpen ? (
                                    <ChevronDown className="w-3 h-3 text-zinc-400" />
                                ) : (
                                    <ChevronRight className="w-3 h-3 text-zinc-400" />
                                )}
                                <History className="w-3 h-3 text-zinc-400" />
                                <span className="text-zinc-500 dark:text-zinc-400 font-medium">
                                    Sync History
                                </span>
                            </button>
                            {historyOpen && (
                                <div className="px-3 pb-2">
                                    {loadingHistory ? (
                                        <div className="flex items-center justify-center py-3">
                                            <Loader2 className="w-3 h-3 animate-spin text-zinc-400" />
                                        </div>
                                    ) : syncHistory.length === 0 ? (
                                        <p className="text-zinc-400 italic py-2">No sync history yet</p>
                                    ) : (
                                            <div className="space-y-4 relative pl-1">
                                                {/* Vertical connecting line */}
                                                <div className="absolute left-[13px] top-4 bottom-4 w-px bg-zinc-200 dark:bg-zinc-800" />
                                                
                                                {syncHistory.map((ev, i) => (
                                                    <div
                                                        key={ev.id}
                                                        className="flex items-start gap-3 relative"
                                                    >
                                                        {/* Timeline Node */}
                                                        <div className="relative z-10 flex items-center justify-center w-6 h-6 rounded-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 shadow-sm mt-0.5">
                                                            {ev.type === "git_push" ? (
                                                                <Upload className="w-3 h-3 text-blue-500" />
                                                            ) : (
                                                                <Download className="w-3 h-3 text-emerald-500" />
                                                            )}
                                                        </div>

                                                        {/* Content */}
                                                        <div className="flex-1 min-w-0 pt-1 pb-2">
                                                            <div className="text-zinc-700 dark:text-zinc-300 font-medium text-xs flex items-center gap-1.5">
                                                                {ev.type === "git_push" ? "Pushed commits" : "Pulled changes"}
                                                                {!!ev.metadata?.commitSha && (
                                                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-[9px] font-mono text-zinc-500 font-normal">
                                                                        {typeof ev.metadata.commitSha === "string" ? ev.metadata.commitSha.slice(0, 7) : String(ev.metadata.commitSha ?? "").slice(0, 7)}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="text-[10px] text-zinc-400 mt-0.5">
                                                                {new Date(ev.createdAt).toLocaleString()}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
