'use client';

import type { Dispatch, SetStateAction } from 'react';
import { ChevronLeft, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MessagingStructuredCatalogV2 } from '@/app/actions/messaging/collaboration';
import type {
    SlashMenuItem,
    StructuredActionDraft,
    StructuredActionOption,
} from './message-composer-v2-shared';

interface ComposerSlashMenuProps {
    slashMenuOpen: boolean;
    hasStructuredDraft: boolean;
    activeStructuredOption: StructuredActionOption | null;
    structuredDraft: StructuredActionDraft;
    structuredCatalog: MessagingStructuredCatalogV2 | undefined;
    structuredCatalogLoading: boolean;
    slashItems: SlashMenuItem[];
    slashSelectedIndex: number;
    canSendStructured: boolean;
    structuredSubmitLabel: string;
    setStructuredDraft: Dispatch<SetStateAction<StructuredActionDraft>>;
    setSlashSelectedIndex: Dispatch<SetStateAction<number>>;
    onClose: () => void;
    onReturnToList: () => void;
    onSelectItem: (item: SlashMenuItem) => void;
    onSendStructured: () => void;
}

export function ComposerSlashMenu({
    slashMenuOpen,
    hasStructuredDraft,
    activeStructuredOption,
    structuredDraft,
    structuredCatalog,
    structuredCatalogLoading,
    slashItems,
    slashSelectedIndex,
    canSendStructured,
    structuredSubmitLabel,
    setStructuredDraft,
    setSlashSelectedIndex,
    onClose,
    onReturnToList,
    onSelectItem,
    onSendStructured,
}: ComposerSlashMenuProps) {
    if (!slashMenuOpen) {
        return null;
    }

    return (
        <div className="absolute inset-x-0 bottom-full z-30 mb-3 rounded-3xl border border-zinc-200 bg-white p-3 shadow-[0_18px_48px_rgba(15,23,42,0.14)] dark:border-zinc-800 dark:bg-zinc-950">
            {hasStructuredDraft && activeStructuredOption ? (
                <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-2">
                            <button
                                type="button"
                                onClick={onReturnToList}
                                className="mt-0.5 rounded-full p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                                aria-label="Back to slash menu"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <div className="min-w-0">
                                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                                    {activeStructuredOption.label}
                                </div>
                                <div className="mt-1 text-sm text-zinc-700 dark:text-zinc-200">
                                    {activeStructuredOption.description}
                                </div>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-full p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                            aria-label="Close slash menu"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                        {(structuredDraft.kind === 'project_invite'
                            || structuredDraft.kind === 'feedback_request'
                            || structuredDraft.kind === 'handoff_summary'
                            || structuredDraft.kind === 'rate_share') ? (
                            <label className="space-y-1.5">
                                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Project</span>
                                <select
                                    value={structuredDraft.projectId}
                                    onChange={(event) => setStructuredDraft((current) => ({ ...current, projectId: event.target.value }))}
                                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 dark:border-zinc-800 dark:bg-zinc-950"
                                >
                                    <option value="">No project context</option>
                                    {(structuredCatalog?.projects || []).map((project) => (
                                        <option key={project.id} value={project.id}>
                                            {project.title}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        ) : null}

                        {(structuredDraft.kind === 'task_approval' || structuredDraft.kind === 'handoff_summary' || structuredDraft.kind === 'feedback_request') ? (
                            <label className="space-y-1.5">
                                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Task</span>
                                <select
                                    value={structuredDraft.taskId}
                                    onChange={(event) => setStructuredDraft((current) => ({ ...current, taskId: event.target.value }))}
                                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 dark:border-zinc-800 dark:bg-zinc-950"
                                >
                                    <option value="">No task selected</option>
                                    {(structuredCatalog?.tasks || []).map((task) => (
                                        <option key={task.id} value={task.id}>
                                            #{task.taskNumber} {task.title}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        ) : null}

                        {(structuredDraft.kind === 'feedback_request' || structuredDraft.kind === 'handoff_summary') ? (
                            <label className="space-y-1.5">
                                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">File</span>
                                <select
                                    value={structuredDraft.fileId}
                                    onChange={(event) => setStructuredDraft((current) => ({ ...current, fileId: event.target.value }))}
                                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 dark:border-zinc-800 dark:bg-zinc-950"
                                >
                                    <option value="">No file selected</option>
                                    {(structuredCatalog?.files || []).map((file) => (
                                        <option key={file.id} value={file.id}>
                                            {file.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        ) : null}

                        {structuredDraft.kind === 'feedback_request' ? (
                            <label className="space-y-1.5">
                                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Due</span>
                                <input
                                    type="datetime-local"
                                    value={structuredDraft.dueAt}
                                    onChange={(event) => setStructuredDraft((current) => ({ ...current, dueAt: event.target.value }))}
                                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 dark:border-zinc-800 dark:bg-zinc-950"
                                />
                            </label>
                        ) : null}

                        {structuredDraft.kind === 'rate_share' ? (
                            <>
                                <label className="space-y-1.5">
                                    <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Amount</span>
                                    <input
                                        type="text"
                                        value={structuredDraft.amount}
                                        onChange={(event) => setStructuredDraft((current) => ({ ...current, amount: event.target.value }))}
                                        placeholder="e.g. 40 USD"
                                        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 dark:border-zinc-800 dark:bg-zinc-950"
                                    />
                                </label>
                                <label className="space-y-1.5">
                                    <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Unit</span>
                                    <input
                                        type="text"
                                        value={structuredDraft.unit}
                                        onChange={(event) => setStructuredDraft((current) => ({ ...current, unit: event.target.value }))}
                                        placeholder="hour / project / week"
                                        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 dark:border-zinc-800 dark:bg-zinc-950"
                                    />
                                </label>
                            </>
                        ) : null}
                    </div>

                    {structuredDraft.kind === 'handoff_summary' ? (
                        <div className="grid gap-3">
                            <label className="space-y-1.5">
                                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Completed</span>
                                <textarea
                                    value={structuredDraft.completed}
                                    onChange={(event) => setStructuredDraft((current) => ({ ...current, completed: event.target.value }))}
                                    rows={2}
                                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 dark:border-zinc-800 dark:bg-zinc-950"
                                />
                            </label>
                            <label className="space-y-1.5">
                                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Blocked</span>
                                <textarea
                                    value={structuredDraft.blocked}
                                    onChange={(event) => setStructuredDraft((current) => ({ ...current, blocked: event.target.value }))}
                                    rows={2}
                                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 dark:border-zinc-800 dark:bg-zinc-950"
                                />
                            </label>
                            <label className="space-y-1.5">
                                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Next</span>
                                <textarea
                                    value={structuredDraft.next}
                                    onChange={(event) => setStructuredDraft((current) => ({ ...current, next: event.target.value }))}
                                    rows={2}
                                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 dark:border-zinc-800 dark:bg-zinc-950"
                                />
                            </label>
                        </div>
                    ) : null}

                    {structuredDraft.kind !== 'rate_share' && structuredDraft.kind !== 'project_invite' ? (
                        <label className="space-y-1.5">
                            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Summary</span>
                            <textarea
                                value={structuredDraft.summary}
                                onChange={(event) => setStructuredDraft((current) => ({ ...current, summary: event.target.value }))}
                                rows={2}
                                placeholder={
                                    structuredDraft.kind === 'feedback_request'
                                        ? 'What feedback do you need?'
                                        : structuredDraft.kind === 'availability_request'
                                            ? 'What are you asking them to confirm?'
                                            : 'Add a short summary'
                                }
                                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 dark:border-zinc-800 dark:bg-zinc-950"
                            />
                        </label>
                    ) : null}

                    <label className="space-y-1.5">
                        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                            {structuredDraft.kind === 'project_invite' ? 'Invite note' : 'Optional note'}
                        </span>
                        <textarea
                            value={structuredDraft.note}
                            onChange={(event) => setStructuredDraft((current) => ({ ...current, note: event.target.value }))}
                            rows={structuredDraft.kind === 'handoff_summary' ? 2 : 3}
                            placeholder="Add a short note"
                            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 dark:border-zinc-800 dark:bg-zinc-950"
                        />
                    </label>

                    <div className="flex items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={onSendStructured}
                            disabled={!canSendStructured}
                            className="rounded-xl app-accent-solid px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {structuredSubmitLabel}
                        </button>
                    </div>
                </div>
            ) : (
                <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                                Message actions
                            </div>
                            <div className="mt-1 text-sm text-zinc-700 dark:text-zinc-200">
                                Use <span className="font-semibold">/</span> to insert a minimal structured card or add reusable context.
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-full p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                            aria-label="Close slash menu"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    <div className="max-h-[340px] overflow-y-auto">
                        {slashItems.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-zinc-200 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                                {structuredCatalogLoading ? 'Loading message actions…' : 'No matching commands found.'}
                            </div>
                        ) : (
                            <div className="space-y-1">
                                {slashItems.map((item, index) => {
                                    const showSectionLabel = index === 0 || slashItems[index - 1]?.section !== item.section;
                                    return (
                                        <div key={item.key}>
                                            {showSectionLabel ? (
                                                <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                                                    {item.section}
                                                </div>
                                            ) : null}
                                            <button
                                                type="button"
                                                onMouseEnter={() => setSlashSelectedIndex(index)}
                                                onClick={() => onSelectItem(item)}
                                                className={cn(
                                                    'flex w-full items-start justify-between rounded-2xl px-3 py-2.5 text-left transition-colors',
                                                    slashSelectedIndex === index
                                                        ? 'bg-primary/8 text-zinc-900 dark:bg-primary/12 dark:text-zinc-100'
                                                        : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900',
                                                )}
                                            >
                                                <div className="min-w-0">
                                                    <div className="text-sm font-medium">{item.label}</div>
                                                    <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                                                        {item.description}
                                                    </div>
                                                </div>
                                                <div className="ml-3 shrink-0 rounded-full border border-zinc-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                                                    {item.type === 'action' ? 'Card' : 'Chip'}
                                                </div>
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
