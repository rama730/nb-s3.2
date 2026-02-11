'use client';

import { memo } from 'react';
import Link from 'next/link';
import { Pin, X, CheckSquare, FolderKanban } from 'lucide-react';
import { useWorkspacePins, type PinnedItem } from '@/hooks/useWorkspacePins';
import type { WorkspaceTask } from '@/app/actions/workspace';

interface PinnedStripProps {
    onTaskClick?: (task: WorkspaceTask) => void;
}

function PinnedStrip({ onTaskClick }: PinnedStripProps) {
    const { pins, removePin } = useWorkspacePins();

    if (pins.length === 0) return null;

    return (
        <div className="shrink-0 px-4 pt-3 pb-1">
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
                <Pin className="w-3 h-3 text-zinc-400 shrink-0" />
                {pins.map((pin) => (
                    <PinnedChip key={`${pin.type}:${pin.id}`} pin={pin} onRemove={removePin} onTaskClick={onTaskClick} />
                ))}
            </div>
        </div>
    );
}

function PinnedChip({ pin, onRemove, onTaskClick }: {
    pin: PinnedItem;
    onRemove: (item: Pick<PinnedItem, 'type' | 'id'>) => void;
    onTaskClick?: (task: WorkspaceTask) => void;
}) {
    const Icon = pin.type === 'task' ? CheckSquare : FolderKanban;
    const canOpenTask = pin.type !== 'task' || !!pin.projectId;

    const handleClick = () => {
        if (pin.type === 'task' && onTaskClick && pin.projectId) {
            // Reconstruct minimal WorkspaceTask for the panel
            onTaskClick({
                id: pin.id,
                title: pin.title,
                status: 'todo',
                priority: 'medium',
                dueDate: null,
                taskNumber: pin.taskNumber ?? null,
                projectId: pin.projectId,
                projectTitle: '',
                projectSlug: pin.projectSlug ?? null,
                projectKey: pin.projectKey ?? null,
                createdAt: new Date(),
            });
        }
    };

    const content = (
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors group">
            <Icon className="w-3 h-3 text-zinc-400" />
            <span className="truncate max-w-[120px]">{pin.title}</span>
            <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove({ type: pin.type, id: pin.id }); }}
                className="ml-0.5 p-0.5 rounded text-zinc-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity"
            >
                <X className="w-3 h-3" />
            </button>
        </div>
    );

    if (pin.type === 'project' && pin.projectSlug) {
        return <Link href={`/projects/${pin.projectSlug}`}>{content}</Link>;
    }

    return (
        <button onClick={handleClick} disabled={!canOpenTask} className="disabled:opacity-60 disabled:cursor-not-allowed">
            {content}
        </button>
    );
}

export default memo(PinnedStrip);
