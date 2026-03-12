'use client';

import { memo, useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { StickyNote, Copy, Trash2, Check, ListPlus } from 'lucide-react';
import { getWorkspacePreferences, saveWorkspaceQuickNotes, type WorkspaceProject } from '@/app/actions/workspace';
import CreateTaskFromNoteModal from '../CreateTaskFromNoteModal';
import type { WidgetCardSizeMode } from '@/components/workspace/dashboard/types';
import { cn } from '@/lib/utils';
import { queryKeys } from '@/lib/query-keys';

const STORAGE_KEY = 'workspace-notes-full';
const STORAGE_UPDATED_AT_KEY = 'workspace-notes-updated-at';

interface QuickNotesProps {
    projects?: WorkspaceProject[];
    sizeMode?: WidgetCardSizeMode;
}

function readLocalNotes() {
    try {
        return {
            content: localStorage.getItem(STORAGE_KEY) ?? '',
            updatedAt: localStorage.getItem(STORAGE_UPDATED_AT_KEY) ?? '',
        };
    } catch {
        return { content: '', updatedAt: '' };
    }
}

function QuickNotes({ projects, sizeMode = 'standard' }: QuickNotesProps) {
    const [showCreateTask, setShowCreateTask] = useState(false);
    const [content, setContent] = useState('');
    const [copied, setCopied] = useState(false);
    const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hydratedRef = useRef(false);
    const isCompact = sizeMode === 'compact';

    useEffect(() => {
        const local = readLocalNotes();
        setContent(local.content);
    }, []);

    useEffect(() => {
        return () => {
            if (syncTimerRef.current) {
                clearTimeout(syncTimerRef.current);
                syncTimerRef.current = null;
            }
        };
    }, []);

    const { data: preferences } = useQuery({
        queryKey: queryKeys.workspace.preferences(),
        queryFn: async () => {
            const result = await getWorkspacePreferences();
            return result.success && result.data ? result.data : null;
        },
        staleTime: 30_000,
    });

    useEffect(() => {
        if (!preferences) return;
        const local = readLocalNotes();
        const serverNotes = preferences.notes;

        if (serverNotes?.content) {
            const parsedServerTime = Date.parse(serverNotes.updatedAt || '');
            const parsedLocalTime = Date.parse(local.updatedAt || '');
            const serverTime = Number.isNaN(parsedServerTime) ? 0 : parsedServerTime;
            const localTime = Number.isNaN(parsedLocalTime) ? 0 : parsedLocalTime;
            if (serverTime >= localTime) {
                setContent(serverNotes.content);
                try {
                    localStorage.setItem(STORAGE_KEY, serverNotes.content);
                    localStorage.setItem(STORAGE_UPDATED_AT_KEY, serverNotes.updatedAt || new Date().toISOString());
                } catch {
                    // ignore local persistence failure
                }
                hydratedRef.current = true;
                return;
            }
        }

        if (!hydratedRef.current && local.content) {
            hydratedRef.current = true;
            void saveWorkspaceQuickNotes(local.content);
        }
    }, [preferences]);

    const persistLocal = useCallback((value: string) => {
        try {
            localStorage.setItem(STORAGE_KEY, value);
            localStorage.setItem(STORAGE_UPDATED_AT_KEY, new Date().toISOString());
        } catch {
            // ignore localStorage errors
        }
    }, []);

    const handleChange = useCallback((value: string) => {
        setContent(value);
        persistLocal(value);

        if (syncTimerRef.current) {
            clearTimeout(syncTimerRef.current);
            syncTimerRef.current = null;
        }
        syncTimerRef.current = setTimeout(() => {
            syncTimerRef.current = null;
            void saveWorkspaceQuickNotes(value);
        }, 800);
    }, [persistLocal]);

    const handleCopy = useCallback(async () => {
        if (!content) return;
        await navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }, [content]);

    const handleClear = useCallback(() => {
        setContent('');
        persistLocal('');
        void saveWorkspaceQuickNotes('');
    }, [persistLocal]);

    return (
        <div className={cn(
            'h-full bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 flex flex-col',
            isCompact ? 'p-3' : 'p-4'
        )}>
            <div className={cn('flex items-center justify-between shrink-0', isCompact ? 'mb-1.5' : 'mb-2')}>
                <div className="flex items-center gap-2">
                    <div className={cn('bg-amber-50 dark:bg-amber-900/20 rounded-lg', isCompact ? 'p-1' : 'p-1.5')}>
                        <StickyNote className={cn('text-amber-600 dark:text-amber-400', isCompact ? 'w-3.5 h-3.5' : 'w-4 h-4')} />
                    </div>
                    <h3 className={cn('font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight', isCompact ? 'text-[13px]' : 'text-sm')}>
                        Quick Notes
                    </h3>
                </div>
                <div className="flex items-center gap-1">
                    {projects && projects.length > 0 && (
                        <button
                            onClick={() => setShowCreateTask(true)}
                            disabled={!content}
                            className={cn(
                                'rounded-md text-zinc-400 hover:text-blue-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 transition-colors',
                                isCompact ? 'p-1' : 'p-1.5'
                            )}
                            title="Create task from note"
                        >
                            <ListPlus className={cn(isCompact ? 'w-3 h-3' : 'w-3.5 h-3.5')} />
                        </button>
                    )}
                    <button
                        onClick={handleCopy}
                        disabled={!content}
                        className={cn(
                            'rounded-md text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 transition-colors',
                            isCompact ? 'p-1' : 'p-1.5'
                        )}
                        title="Copy to clipboard"
                    >
                        {copied ? <Check className={cn('text-emerald-500', isCompact ? 'w-3 h-3' : 'w-3.5 h-3.5')} /> : <Copy className={cn(isCompact ? 'w-3 h-3' : 'w-3.5 h-3.5')} />}
                    </button>
                    <button
                        onClick={handleClear}
                        disabled={!content}
                        className={cn(
                            'rounded-md text-zinc-400 hover:text-rose-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 transition-colors',
                            isCompact ? 'p-1' : 'p-1.5'
                        )}
                        title="Clear notes"
                    >
                        <Trash2 className={cn(isCompact ? 'w-3 h-3' : 'w-3.5 h-3.5')} />
                    </button>
                </div>
            </div>

            <textarea
                value={content}
                onChange={(e) => handleChange(e.target.value)}
                placeholder={isCompact ? 'Quick notes...' : 'Jot down quick ideas, meeting notes, or reminders...'}
                className={cn(
                    'flex-1 min-h-0 w-full resize-none bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800 rounded-lg text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/40 transition-colors',
                    isCompact ? 'p-2.5 text-[13px] leading-5' : 'p-3 text-sm'
                )}
            />

            {!isCompact && (
                <p className="text-[10px] text-zinc-400 mt-1.5 shrink-0">
                    Synced to your account with local offline fallback.
                </p>
            )}

            {showCreateTask && projects && projects.length > 0 && (
                <CreateTaskFromNoteModal
                    defaultTitle={content.split('\n')[0]?.slice(0, 200) || ''}
                    defaultDescription={content}
                    projects={projects}
                    onClose={() => setShowCreateTask(false)}
                />
            )}
        </div>
    );
}

export default memo(QuickNotes);
