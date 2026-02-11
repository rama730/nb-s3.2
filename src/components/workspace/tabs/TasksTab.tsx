'use client';

import { memo, useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    CheckSquare,
    Filter,
    Circle,
    CheckCircle2,
    Loader2,
    Calendar,
    FolderKanban,
} from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import { cn } from '@/lib/utils';
import {
    getWorkspaceTasks,
    type WorkspaceTask,
    type WorkspaceTaskFilters,
    type WorkspaceProject,
} from '@/app/actions/workspace';
import { updateTaskStatusAction } from '@/app/actions/task';
import { toast } from 'sonner';

interface TasksTabProps {
    initialProjects: WorkspaceProject[];
    onTaskClick?: (task: WorkspaceTask) => void;
}

const STATUS_OPTIONS = [
    { value: '', label: 'All Statuses' },
    { value: 'todo', label: 'To Do' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'done', label: 'Done' },
];

const PRIORITY_OPTIONS = [
    { value: '', label: 'All Priorities' },
    { value: 'urgent', label: 'Urgent' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
];

const PRIORITY_DOT: Record<string, string> = {
    urgent: 'bg-rose-500',
    high: 'bg-orange-500',
    medium: 'bg-amber-500',
    low: 'bg-zinc-400',
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
    todo: { label: 'To Do', cls: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' },
    in_progress: { label: 'In Progress', cls: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300' },
    done: { label: 'Done', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300' },
    blocked: { label: 'Blocked', cls: 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300' },
};

const FILTER_STORAGE_KEY = 'workspace-task-filters';

interface PersistedFilters {
    status?: string;
    priority?: string;
    projectId?: string;
    groupBy?: 'project' | 'dueDate';
}

const TASK_STATUS_VALUES: NonNullable<WorkspaceTaskFilters['status']>[] = ['todo', 'in_progress', 'done', 'blocked'];
const TASK_PRIORITY_VALUES: NonNullable<WorkspaceTaskFilters['priority']>[] = ['low', 'medium', 'high', 'urgent'];

function isTaskStatus(value: string): value is NonNullable<WorkspaceTaskFilters['status']> {
    return TASK_STATUS_VALUES.includes(value as NonNullable<WorkspaceTaskFilters['status']>);
}

function isTaskPriority(value: string): value is NonNullable<WorkspaceTaskFilters['priority']> {
    return TASK_PRIORITY_VALUES.includes(value as NonNullable<WorkspaceTaskFilters['priority']>);
}

function loadPersistedFilters(): PersistedFilters {
    try {
        const saved = localStorage.getItem(FILTER_STORAGE_KEY);
        if (saved) return JSON.parse(saved);
    } catch { /* noop */ }
    return {};
}

function persistFilters(filters: PersistedFilters) {
    try { localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters)); } catch { /* noop */ }
}

type VirtualItem = { kind: 'header'; label: string; count: number; isOverdue?: boolean } | { kind: 'task'; task: WorkspaceTask };

function TasksTab({ initialProjects, onTaskClick }: TasksTabProps) {
    const queryClient = useQueryClient();

    // 2F: Seed filters from localStorage
    const [filters, setFilters] = useState<WorkspaceTaskFilters>(() => {
        const p = loadPersistedFilters();
        return {
            status: p.status && isTaskStatus(p.status) ? p.status : undefined,
            priority: p.priority && isTaskPriority(p.priority) ? p.priority : undefined,
            projectId: p.projectId,
        };
    });
    const [cursor, setCursor] = useState<string | undefined>(undefined);
    const [allTasks, setAllTasks] = useState<WorkspaceTask[]>([]);
    const [groupBy, setGroupBy] = useState<'project' | 'dueDate'>(() => loadPersistedFilters().groupBy || 'project');

    // 2F: Persist on change
    useEffect(() => {
        persistFilters({ ...filters, groupBy });
    }, [filters, groupBy]);

    const { data, isLoading, isFetching } = useQuery({
        queryKey: ['workspace', 'tasks', filters, cursor],
        queryFn: async () => {
            const result = await getWorkspaceTasks(filters, cursor, 20);
            if (result.success && result.tasks) {
                if (cursor) {
                    setAllTasks((prev) => [...prev, ...result.tasks!]);
                } else {
                    setAllTasks(result.tasks);
                }
            }
            return result;
        },
        staleTime: 30_000,
    });

    const handleFilterChange = useCallback((key: keyof WorkspaceTaskFilters, value: string) => {
        setCursor(undefined);
        setAllTasks([]);
        setFilters((prev) => {
            if (key === 'status') {
                return { ...prev, status: value && isTaskStatus(value) ? value : undefined };
            }
            if (key === 'priority') {
                return { ...prev, priority: value && isTaskPriority(value) ? value : undefined };
            }
            return { ...prev, projectId: value || undefined };
        });
    }, []);

    const handleLoadMore = useCallback(() => {
        if (data?.nextCursor) {
            setCursor(data.nextCursor);
        }
    }, [data]);

    const handleStatusToggle = useCallback(async (taskId: string, currentStatus: string, projectId: string) => {
        const nextStatus = currentStatus === 'todo' ? 'in_progress' : currentStatus === 'in_progress' ? 'done' : 'todo';
        const label = nextStatus === 'in_progress' ? 'Task started' : nextStatus === 'done' ? 'Task marked as done' : 'Task moved to To Do';

        // Optimistic: update local list
        setAllTasks((prev) =>
            prev.map((t) => (t.id === taskId ? { ...t, status: nextStatus } : t))
        );

        try {
            await updateTaskStatusAction(taskId, nextStatus, projectId);
            toast.success(label);
        } catch {
            toast.error('Failed to update task');
        }
        queryClient.invalidateQueries({ queryKey: ['workspace'] });
    }, [queryClient]);

    // Build flat virtual items for Virtuoso
    const virtualItems = useMemo((): VirtualItem[] => {
        const items: VirtualItem[] = [];
        if (groupBy === 'project') {
            const byProject = allTasks.reduce<Record<string, { projectTitle: string; projectSlug: string | null; projectKey: string | null; tasks: WorkspaceTask[] }>>((acc, task) => {
                if (!acc[task.projectId]) {
                    acc[task.projectId] = { projectTitle: task.projectTitle, projectSlug: task.projectSlug, projectKey: task.projectKey, tasks: [] };
                }
                acc[task.projectId].tasks.push(task);
                return acc;
            }, {});
            for (const [, group] of Object.entries(byProject)) {
                items.push({ kind: 'header', label: group.projectKey || group.projectTitle, count: group.tasks.length });
                for (const task of group.tasks) {
                    items.push({ kind: 'task', task });
                }
            }
        } else {
            const now = new Date();
            const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
            const endOfWeek = new Date(endOfToday);
            endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));
            const groups: Record<string, WorkspaceTask[]> = { Overdue: [], Today: [], 'This Week': [], Later: [], 'No Date': [] };
            for (const t of allTasks) {
                if (!t.dueDate) { groups['No Date'].push(t); continue; }
                const d = new Date(t.dueDate);
                if (d < now) groups.Overdue.push(t);
                else if (d <= endOfToday) groups.Today.push(t);
                else if (d <= endOfWeek) groups['This Week'].push(t);
                else groups.Later.push(t);
            }
            for (const [label, tasks] of Object.entries(groups)) {
                if (tasks.length === 0) continue;
                items.push({ kind: 'header', label, count: tasks.length, isOverdue: label === 'Overdue' });
                for (const task of tasks) {
                    items.push({ kind: 'task', task });
                }
            }
        }
        return items;
    }, [allTasks, groupBy]);

    return (
        <div className="space-y-6">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 text-sm text-zinc-500">
                    <Filter className="w-4 h-4" />
                    <span>Filters:</span>
                </div>

                <select
                    value={filters.status || ''}
                    onChange={(e) => handleFilterChange('status', e.target.value)}
                    className="text-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                    {STATUS_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                </select>

                <select
                    value={filters.priority || ''}
                    onChange={(e) => handleFilterChange('priority', e.target.value)}
                    className="text-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                    {PRIORITY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                </select>

                <select
                    value={filters.projectId || ''}
                    onChange={(e) => handleFilterChange('projectId', e.target.value)}
                    className="text-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                    <option value="">All Projects</option>
                    {initialProjects.map((p) => (
                        <option key={p.id} value={p.id}>{p.title}</option>
                    ))}
                </select>

                {/* Group by toggle */}
                <div className="flex items-center gap-0.5 ml-auto bg-zinc-100 dark:bg-zinc-800 rounded-lg p-0.5">
                    <button
                        onClick={() => setGroupBy('project')}
                        className={cn(
                            'flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors',
                            groupBy === 'project' ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                        )}
                    >
                        <FolderKanban className="w-3 h-3" />
                        Project
                    </button>
                    <button
                        onClick={() => setGroupBy('dueDate')}
                        className={cn(
                            'flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors',
                            groupBy === 'dueDate' ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                        )}
                    >
                        <Calendar className="w-3 h-3" />
                        Due Date
                    </button>
                </div>
            </div>

            {/* Task list */}
            {isLoading && allTasks.length === 0 ? (
                <div className="flex items-center justify-center py-16 text-zinc-400">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    <span className="text-sm">Loading tasks...</span>
                </div>
            ) : allTasks.length === 0 ? (
                <div className="text-center py-16 text-zinc-400">
                    <CheckSquare className="w-10 h-10 mx-auto mb-3 opacity-50" />
                    <p className="text-sm font-medium">No tasks found</p>
                    <p className="text-xs mt-1">Try changing your filters or check back later.</p>
                </div>
            ) : (
                <Virtuoso
                    data={virtualItems}
                    useWindowScroll
                    endReached={() => {
                        if (data?.hasMore && !isFetching) handleLoadMore();
                    }}
                    itemContent={(_, item) => {
                        if (item.kind === 'header') {
                            return (
                                <div className="flex items-center gap-2 mb-3 mt-6 first:mt-0">
                                    <span className={cn(
                                        'text-xs font-semibold uppercase tracking-wider',
                                        item.isOverdue ? 'text-rose-600 dark:text-rose-400' : 'text-zinc-500 dark:text-zinc-400'
                                    )}>
                                        {item.label}
                                    </span>
                                    <span className="text-[10px] text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                                        {item.count}
                                    </span>
                                </div>
                            );
                        }
                        return (
                            <div className="mb-1">
                                <TaskRow task={item.task} onStatusToggle={handleStatusToggle} onTaskClick={onTaskClick} />
                            </div>
                        );
                    }}
                    components={{
                        Footer: () =>
                            isFetching ? (
                                <div className="flex justify-center py-4">
                                    <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
                                </div>
                            ) : null,
                    }}
                />
            )}
        </div>
    );
}

// Extracted task row for reuse in both grouping modes
function TaskRow({ task, onStatusToggle, onTaskClick }: {
    task: WorkspaceTask;
    onStatusToggle: (taskId: string, status: string, projectId: string) => void;
    onTaskClick?: (task: WorkspaceTask) => void;
}) {
    const badge = STATUS_BADGE[task.status] || STATUS_BADGE.todo;
    return (
        <div
            className="flex items-center gap-3 p-3 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 hover:border-zinc-200 dark:hover:border-zinc-700 transition-colors cursor-pointer"
            onClick={() => onTaskClick?.(task)}
        >
            <button
                onClick={(e) => { e.stopPropagation(); onStatusToggle(task.id, task.status, task.projectId); }}
                className="shrink-0 text-zinc-300 dark:text-zinc-600 hover:text-blue-500 transition-colors"
            >
                {task.status === 'done' ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                ) : task.status === 'in_progress' ? (
                    <CheckCircle2 className="w-5 h-5 text-blue-500" />
                ) : (
                    <Circle className="w-5 h-5" />
                )}
            </button>
            <div className="flex-1 min-w-0">
                <p className={cn(
                    'text-sm font-medium line-clamp-1',
                    task.status === 'done' ? 'text-zinc-400 line-through' : 'text-zinc-800 dark:text-zinc-200'
                )}>
                    {task.title}
                </p>
                <span className="text-[10px] text-zinc-400 font-mono">
                    {task.projectKey}-{task.taskNumber}
                </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
                <div className={cn('w-2 h-2 rounded-full', PRIORITY_DOT[task.priority] || PRIORITY_DOT.medium)} />
                <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded', badge.cls)}>
                    {badge.label}
                </span>
                {task.dueDate && (
                    <span className={cn(
                        'text-[10px] font-medium px-1.5 py-0.5 rounded',
                        new Date(task.dueDate) < new Date()
                            ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                            : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                    )}>
                        {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                )}
            </div>
        </div>
    );
}

export default memo(TasksTab);
