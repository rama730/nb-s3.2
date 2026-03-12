'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { X, Loader2, CheckSquare } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { createTaskAction } from '@/app/actions/project';
import type { WorkspaceProject } from '@/app/actions/workspace';
import { toast } from 'sonner';
import { queryKeys } from '@/lib/query-keys';

interface CreateTaskFromNoteModalProps {
    defaultTitle: string;
    defaultDescription: string;
    projects: WorkspaceProject[];
    onClose: () => void;
}

export default function CreateTaskFromNoteModal({
    defaultTitle,
    defaultDescription,
    projects,
    onClose,
}: CreateTaskFromNoteModalProps) {
    const queryClient = useQueryClient();
    const [title, setTitle] = useState(defaultTitle.slice(0, 200));
    const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
    const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const modalRef = useRef<HTMLDivElement>(null);
    const firstInputRef = useRef<HTMLInputElement>(null);

    // 4A: Focus trap + auto-focus
    useEffect(() => {
        firstInputRef.current?.focus();

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
                return;
            }
            if (e.key !== 'Tab' || !modalRef.current) return;

            const focusable = modalRef.current.querySelectorAll<HTMLElement>(
                'input, select, button, textarea, [tabindex]:not([tabindex="-1"])'
            );
            if (focusable.length === 0) return;

            const first = focusable[0];
            const last = focusable[focusable.length - 1];

            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const handleSubmit = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim() || !projectId) return;

        setIsSubmitting(true);
        setError(null);
        try {
            const result = await createTaskAction({
                projectId,
                title: title.trim(),
                description: defaultDescription || undefined,
                priority,
                status: 'todo',
            });
            if (result.success) {
                setSuccess(true);
                const projectName = projects.find(p => p.id === projectId)?.title || 'project';
                toast.success(`Task created in ${projectName}`);
                queryClient.invalidateQueries({ queryKey: queryKeys.workspace.tasksRoot() });
                queryClient.invalidateQueries({ queryKey: queryKeys.workspace.overviewBase() });
                queryClient.invalidateQueries({ queryKey: queryKeys.workspace.overviewSection.tasks() });
                queryClient.invalidateQueries({ queryKey: queryKeys.workspace.overviewSection.projects() });
                setTimeout(onClose, 800);
            } else {
                setError(result.error || 'Failed to create task');
                toast.error(result.error || 'Failed to create task');
            }
        } catch {
            setError('An unexpected error occurred');
            toast.error('An unexpected error occurred');
        } finally {
            setIsSubmitting(false);
        }
    }, [title, projectId, priority, defaultDescription, projects, queryClient, onClose]);

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="create-task-modal-title"
                className="relative bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-2xl w-full max-w-md mx-4 p-6"
            >
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <CheckSquare className="w-4 h-4 text-blue-600" />
                        <h3 id="create-task-modal-title" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            Create Task from Note
                        </h3>
                    </div>
                    <button onClick={onClose} className="p-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {success ? (
                    <div className="text-center py-6">
                        <div className="w-10 h-10 mx-auto mb-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-full flex items-center justify-center">
                            <CheckSquare className="w-5 h-5 text-emerald-500" />
                        </div>
                        <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Task created!</p>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="text-xs font-medium text-zinc-500 mb-1 block">Title</label>
                            <input
                                ref={firstInputRef}
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                className="w-full text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                placeholder="Task title"
                                required
                            />
                        </div>

                        <div>
                            <label className="text-xs font-medium text-zinc-500 mb-1 block">Project</label>
                            <select
                                value={projectId}
                                onChange={(e) => setProjectId(e.target.value)}
                                className="w-full text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                required
                            >
                                {projects.map((p) => (
                                    <option key={p.id} value={p.id}>{p.title}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="text-xs font-medium text-zinc-500 mb-1 block">Priority</label>
                            <select
                                value={priority}
                                onChange={(e) => setPriority(e.target.value as typeof priority)}
                                className="w-full text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                            >
                                <option value="low">Low</option>
                                <option value="medium">Medium</option>
                                <option value="high">High</option>
                                <option value="urgent">Urgent</option>
                            </select>
                        </div>

                        {error && (
                            <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
                        )}

                        <button
                            type="submit"
                            disabled={isSubmitting || !title.trim() || !projectId}
                            className="w-full flex items-center justify-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                        >
                            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                            Create Task
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
