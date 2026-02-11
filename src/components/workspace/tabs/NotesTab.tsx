'use client';

import { memo, useState, useEffect, useCallback, useRef } from 'react';
import { StickyNote, Copy, Trash2, Check, Download, ListPlus } from 'lucide-react';
import type { WorkspaceProject } from '@/app/actions/workspace';
import CreateTaskFromNoteModal from '../CreateTaskFromNoteModal';

const STORAGE_KEY = 'workspace-notes-full';

interface NotesTabProps {
    projects?: WorkspaceProject[];
}

function NotesTab({ projects }: NotesTabProps) {
    const [showCreateTask, setShowCreateTask] = useState(false);
    const [createTaskTitle, setCreateTaskTitle] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [content, setContent] = useState('');
    const [copied, setCopied] = useState(false);
    const [lastSaved, setLastSaved] = useState<Date | null>(null);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Load from localStorage on mount
    useEffect(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) setContent(saved);
        } catch {
            // localStorage unavailable
        }
    }, []);

    // Debounced auto-save (500ms)
    const handleChange = useCallback((value: string) => {
        setContent(value);
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            try {
                localStorage.setItem(STORAGE_KEY, value);
                setLastSaved(new Date());
            } catch {
                // localStorage unavailable
            }
        }, 500);
    }, []);

    const handleCopy = useCallback(async () => {
        if (!content) return;
        await navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }, [content]);

    const handleClear = useCallback(() => {
        if (!content) return;
        if (!window.confirm('Clear all notes? This cannot be undone.')) return;
        setContent('');
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch {
            // localStorage unavailable
        }
    }, [content]);

    const handleDownload = useCallback(() => {
        if (!content) return;
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `workspace-notes-${new Date().toISOString().split('T')[0]}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    }, [content]);

    const handleOpenCreateTask = useCallback(() => {
        setCreateTaskTitle(getSelectedOrFirstLine(textareaRef.current, content));
        setShowCreateTask(true);
    }, [content]);

    return (
        <div className="flex flex-col h-full min-h-[60vh]">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <StickyNote className="w-5 h-5 text-amber-500" />
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        Workspace Notes
                    </h3>
                    {lastSaved && (
                        <span className="text-[10px] text-zinc-400">
                            Saved {lastSaved.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    {projects && projects.length > 0 && (
                        <button
                            onClick={handleOpenCreateTask}
                            disabled={!content}
                            className="p-2 rounded-lg text-zinc-400 hover:text-blue-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 transition-colors"
                            title="Create task from note"
                        >
                            <ListPlus className="w-4 h-4" />
                        </button>
                    )}
                    <button
                        onClick={handleCopy}
                        disabled={!content}
                        className="p-2 rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 transition-colors"
                        title="Copy to clipboard"
                    >
                        {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                    </button>
                    <button
                        onClick={handleDownload}
                        disabled={!content}
                        className="p-2 rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 transition-colors"
                        title="Download as text file"
                    >
                        <Download className="w-4 h-4" />
                    </button>
                    <button
                        onClick={handleClear}
                        disabled={!content}
                        className="p-2 rounded-lg text-zinc-400 hover:text-rose-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 transition-colors"
                        title="Clear all notes"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Editor */}
            <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => handleChange(e.target.value)}
                placeholder="Write your notes here...

Use this space for meeting notes, brainstorming, task breakdowns, or anything you need to remember.

Your notes are automatically saved to this browser."
                className="flex-1 w-full resize-none bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/40 transition-colors font-mono"
            />

            {/* Footer */}
            <div className="flex items-center justify-between mt-3">
                <p className="text-[10px] text-zinc-400">
                    Auto-saves locally. Your notes stay private on this device.
                </p>
                <p className="text-[10px] text-zinc-400">
                    {content.length} characters
                </p>
            </div>

            {showCreateTask && projects && projects.length > 0 && (
                <CreateTaskFromNoteModal
                    defaultTitle={createTaskTitle}
                    defaultDescription={content}
                    projects={projects}
                    onClose={() => setShowCreateTask(false)}
                />
            )}
        </div>
    );
}

function getSelectedOrFirstLine(textarea: HTMLTextAreaElement | null, content: string): string {
    if (textarea) {
        const { selectionStart, selectionEnd } = textarea;
        if (selectionStart !== selectionEnd) {
            return content.slice(selectionStart, selectionEnd).split('\n')[0]?.slice(0, 200) || '';
        }
    }
    return content.split('\n')[0]?.slice(0, 200) || '';
}

export default memo(NotesTab);
