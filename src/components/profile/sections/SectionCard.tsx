"use client";

import { Plus, Edit2 } from "lucide-react";
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionCardProps {
    title: string;
    icon?: ReactNode;
    isOwner: boolean;
    onAdd?: () => void;
    onEdit?: () => void;
    children: ReactNode;
    emptyState?: ReactNode;
    isEmpty?: boolean;
}

export default function SectionCard({
    title,
    icon,
    isOwner,
    onAdd,
    onEdit,
    children,
    emptyState,
    isEmpty = false,
}: SectionCardProps) {
    return (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden hover:shadow-lg transition-all duration-300">
            {/* Section Header */}
            <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    {icon && <div className="text-zinc-600 dark:text-zinc-400">{icon}</div>}
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">{title}</h2>
                </div>
                {isOwner && (
                    <div className="flex items-center gap-2">
                        {onEdit && !isEmpty && (
                            <button
                                onClick={onEdit}
                                className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                aria-label="Edit"
                            >
                                <Edit2 className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
                            </button>
                        )}
                        {onAdd && (
                            <button
                                onClick={onAdd}
                                className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                aria-label="Add"
                            >
                                <Plus className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Section Content */}
            <div className="p-6">
                {isEmpty && emptyState ? emptyState : children}
            </div>
        </div>
    );
}
