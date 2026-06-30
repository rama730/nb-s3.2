'use client';

import React, { useEffect, useState, useTransition } from 'react';
import {
    GitBranch,
    GitCommit,
    UploadCloud,
    RefreshCw,
    AlertTriangle,
    X,
    CheckCircle2,
    Play,
    Loader2,
    FileText
} from 'lucide-react';
import {
    getPendingDeltasAction,
    getProjectConflictsAction,
    resolveConflictAction
} from '@/app/actions/files/gitActions';
import { pushToGitHub, pullFromGitHub } from '@/app/actions/git';
import { useToast } from '@/components/ui-custom/Toast';

interface GitHubSyncDrawerProps {
    projectId: string;
    onClose: () => void;
}

export function GitHubSyncDrawer({ projectId, onClose }: GitHubSyncDrawerProps): React.JSX.Element {
    const { showToast } = useToast();
    const [pendingDeltas, setPendingDeltas] = useState<any[]>([]);
    const [conflicts, setConflicts] = useState<any[]>([]);
    const [targetBranch, setTargetBranch] = useState('main');
    const [commitMessage, setCommitMessage] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    
    // Resolution states per conflict
    const [selectedResolution, setSelectedResolution] = useState<Record<string, 'keep_mine' | 'keep_remote' | 'merge'>>({});
    const [customMergeContent, setCustomMergeContent] = useState<Record<string, string>>({});
    const [resolvingId, setResolvingId] = useState<string | null>(null);

    const [isPending, startTransition] = useTransition();

    const fetchSyncData = () => {
        startTransition(async () => {
            const deltasRes = await getPendingDeltasAction(projectId, targetBranch);
            if (deltasRes.success && deltasRes.deltas) {
                setPendingDeltas(deltasRes.deltas);
            }

            const conflictsRes = await getProjectConflictsAction(projectId, targetBranch);
            if (conflictsRes.success && conflictsRes.conflicts) {
                setConflicts(conflictsRes.conflicts);
                // Initialize default resolutions and contents
                const resolutions: typeof selectedResolution = {};
                const contents: typeof customMergeContent = {};
                conflictsRes.conflicts.forEach((c) => {
                    resolutions[c.id] = 'keep_mine';
                    contents[c.id] = c.mergedContent || '';
                });
                setSelectedResolution(resolutions);
                setCustomMergeContent(contents);
            }
        });
    };

    useEffect(() => {
        fetchSyncData();
    }, [projectId, targetBranch]);

    const handlePush = async () => {
        if (!commitMessage.trim()) {
            showToast('Commit message is required before pushing changes.', 'error');
            return;
        }
        setIsLoading(true);
        try {
            const res = await pushToGitHub(projectId, commitMessage);
            if (res.success) {
                showToast('GitHub push job triggered successfully!', 'success');
                setCommitMessage('');
                fetchSyncData();
            } else {
                showToast(`Push failed: ${res.error}`, 'error');
            }
        } catch (err: any) {
            showToast(`Error: ${err.message}`, 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handlePull = async () => {
        setIsLoading(true);
        try {
            const res = await pullFromGitHub(projectId);
            if (res.success) {
                showToast('GitHub pull job triggered successfully!', 'success');
                fetchSyncData();
            } else {
                showToast(`Pull failed: ${res.error}`, 'error');
            }
        } catch (err: any) {
            showToast(`Error: ${err.message}`, 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleResolve = async (conflictId: string) => {
        const resolution = selectedResolution[conflictId] || 'keep_mine';
        const content = customMergeContent[conflictId] || '';

        setResolvingId(conflictId);
        try {
            const res = await resolveConflictAction(conflictId, resolution, content);
            if (res.success) {
                showToast('Conflict resolved successfully!', 'success');
                fetchSyncData();
            } else {
                showToast(`Failed to resolve conflict: ${res.error}`, 'error');
            }
        } catch (err: any) {
            showToast(`Error: ${err.message}`, 'error');
        } finally {
            setResolvingId(null);
        }
    };

    return (
        <aside
            className="w-80 border-l border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 h-full flex flex-col select-none transition-all duration-300 ease-in-out shadow-lg"
            aria-label="GitHub Synchronization Panel"
        >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
                <div className="flex items-center gap-2">
                    <GitBranch className="w-4 h-4 text-indigo-500" />
                    <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-50">GitHub Sync</span>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="p-1 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
                {/* Branch Info */}
                <div className="space-y-2">
                    <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Sync Branch</label>
                    <div className="flex items-center gap-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 shadow-sm">
                        <GitBranch className="w-4 h-4 text-zinc-500" />
                        <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200">{targetBranch}</span>
                    </div>
                </div>

                {/* Conflict Resolution Block */}
                {conflicts.length > 0 && (
                    <div className="space-y-3">
                        <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-500 font-semibold text-xs">
                            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                            <span>Unresolved Conflicts ({conflicts.length})</span>
                        </div>
                        <div className="space-y-3">
                            {conflicts.map((c) => (
                                <div
                                    key={c.id}
                                    className="border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 rounded-lg p-3 space-y-2.5 text-xs shadow-sm"
                                >
                                    <div className="flex items-center gap-1 text-zinc-900 dark:text-zinc-100 font-medium">
                                        <FileText className="w-3.5 h-3.5 text-zinc-500" />
                                        <span className="truncate" title={c.filePath}>{c.fileName}</span>
                                    </div>

                                    {/* Resolution Options */}
                                    <div className="space-y-1 bg-white dark:bg-zinc-900/60 p-2 rounded border border-zinc-100 dark:border-zinc-800/40">
                                        <label className="flex items-center gap-2 cursor-pointer py-0.5">
                                            <input
                                                type="radio"
                                                name={`resolution-${c.id}`}
                                                checked={selectedResolution[c.id] === 'keep_mine'}
                                                onChange={() => setSelectedResolution((prev) => ({ ...prev, [c.id]: 'keep_mine' }))}
                                                className="text-indigo-600 focus:ring-indigo-500 h-3 w-3"
                                            />
                                            <span className="text-[11px] text-zinc-700 dark:text-zinc-300">Keep Local (Mine)</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer py-0.5">
                                            <input
                                                type="radio"
                                                name={`resolution-${c.id}`}
                                                checked={selectedResolution[c.id] === 'keep_remote'}
                                                onChange={() => setSelectedResolution((prev) => ({ ...prev, [c.id]: 'keep_remote' }))}
                                                className="text-indigo-600 focus:ring-indigo-500 h-3 w-3"
                                            />
                                            <span className="text-[11px] text-zinc-700 dark:text-zinc-300">Keep GitHub (Remote)</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer py-0.5">
                                            <input
                                                type="radio"
                                                name={`resolution-${c.id}`}
                                                checked={selectedResolution[c.id] === 'merge'}
                                                onChange={() => setSelectedResolution((prev) => ({ ...prev, [c.id]: 'merge' }))}
                                                className="text-indigo-600 focus:ring-indigo-500 h-3 w-3"
                                            />
                                            <span className="text-[11px] text-zinc-700 dark:text-zinc-300">Merge Content</span>
                                        </label>
                                    </div>

                                    {/* Merge Textarea */}
                                    {selectedResolution[c.id] === 'merge' && (
                                        <textarea
                                            value={customMergeContent[c.id] || ''}
                                            onChange={(e) => setCustomMergeContent((prev) => ({ ...prev, [c.id]: e.target.value }))}
                                            rows={5}
                                            className="w-full text-[10px] font-mono p-1.5 border border-zinc-200 dark:border-zinc-800 rounded bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                            placeholder="Write merged file contents..."
                                        />
                                    )}

                                    {/* Action Button */}
                                    <button
                                        type="button"
                                        disabled={resolvingId === c.id}
                                        onClick={() => handleResolve(c.id)}
                                        className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-medium hover:shadow transition-all text-xs disabled:opacity-50"
                                    >
                                        {resolvingId === c.id ? (
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        ) : (
                                            <CheckCircle2 className="w-3.5 h-3.5" />
                                        )}
                                        <span>Apply Resolution</span>
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Cloud Changes Section */}
                <div className="space-y-2.5">
                    <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Cloud Changes ({pendingDeltas.length})</label>
                    <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 space-y-3 max-h-56 overflow-y-auto shadow-sm">
                        {pendingDeltas.length === 0 ? (
                            <div className="text-center py-4 text-xs text-zinc-400 dark:text-zinc-500">
                                No uncommitted cloud changes.
                            </div>
                        ) : (
                            <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
                                {pendingDeltas.map((d) => (
                                    <div key={d.id} className="flex items-center justify-between py-1.5 text-xs">
                                        <span className="truncate font-mono text-zinc-700 dark:text-zinc-300 max-w-[170px]" title={d.path}>
                                            {d.path}
                                        </span>
                                        <span
                                            className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-semibold tracking-wider ${
                                                d.action === 'add'
                                                    ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/35 dark:text-emerald-400'
                                                    : d.action === 'modify'
                                                    ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/35 dark:text-amber-400'
                                                    : 'bg-rose-50 text-rose-600 dark:bg-rose-950/35 dark:text-rose-400'
                                            }`}
                                        >
                                            {d.action}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Push Form */}
                <div className="space-y-3 pt-2">
                    <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Publish to GitHub</label>
                    <div className="space-y-2">
                        <textarea
                            value={commitMessage}
                            onChange={(e) => setCommitMessage(e.target.value)}
                            disabled={isLoading || conflicts.length > 0}
                            placeholder="Enter commit message..."
                            className="w-full text-xs p-2.5 border border-zinc-200 dark:border-zinc-800 rounded-lg bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all resize-none disabled:opacity-50"
                            rows={3}
                        />
                        <button
                            type="button"
                            disabled={isLoading || pendingDeltas.length === 0 || conflicts.length > 0}
                            onClick={handlePush}
                            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium hover:shadow-md hover:shadow-indigo-500/10 transition-all text-xs disabled:opacity-50"
                        >
                            {isLoading ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <UploadCloud className="w-4 h-4" />
                            )}
                            <span>Push Changes</span>
                        </button>
                    </div>
                </div>

                {/* Sync/Pull Button */}
                <div className="border-t border-zinc-200 dark:border-zinc-800 pt-4">
                    <button
                        type="button"
                        disabled={isLoading || conflicts.length > 0}
                        onClick={handlePull}
                        className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300 font-medium border border-zinc-200 dark:border-zinc-800 hover:shadow transition-all text-xs disabled:opacity-50"
                    >
                        {isLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <RefreshCw className="w-4 h-4" />
                        )}
                        <span>Sync with Remote (Pull)</span>
                    </button>
                </div>
            </div>
        </aside>
    );
}
