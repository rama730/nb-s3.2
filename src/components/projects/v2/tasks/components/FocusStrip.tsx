import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, LucideIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Task } from "../TaskCard";
import { useReducedMotionPreference } from "@/components/providers/theme-provider";
import TaskPriorityBadge from "../badges/TaskPriorityBadge";
import TaskStatusBadge from "../badges/TaskStatusBadge";
import {
    FOCUS_STRIP_PREVIEW_LIMIT,
    getFocusDescriptionLineClamp,
    getFocusStripMode,
    getFocusTaskUrgency,
} from "@/lib/projects/task-focus";

interface FocusStripProps {
    title: string;
    icon: LucideIcon;
    iconColorClass: string;
    tasks: Task[];
    onTaskClick: (task: Task) => void;
    previewLimit?: number;
    renderTaskAction?: (task: Task) => React.ReactNode;
}

function FocusUrgencyChip({ task }: { task: Task }) {
    const urgency = getFocusTaskUrgency(task);

    if (urgency === "overdue") {
        return (
            <span className="rounded px-2 py-0.5 text-[10px] font-medium whitespace-nowrap bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">
                Overdue
            </span>
        );
    }

    if (urgency === "due_today") {
        return (
            <span className="rounded px-2 py-0.5 text-[10px] font-medium whitespace-nowrap bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                Due today
            </span>
        );
    }

    return null;
}

export default function FocusStrip({
    title,
    icon: Icon,
    iconColorClass,
    tasks,
    onTaskClick,
    previewLimit = FOCUS_STRIP_PREVIEW_LIMIT,
    renderTaskAction,
}: FocusStripProps) {
    const reduceMotion = useReducedMotionPreference();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [expanded, setExpanded] = useState(true);
    const [showAll, setShowAll] = useState(false);
    const [containerWidth, setContainerWidth] = useState<number | null>(null);

    useEffect(() => {
        const node = containerRef.current;
        if (!node || typeof ResizeObserver === "undefined") return;

        const updateWidth = (nextWidth?: number) => {
            const width = typeof nextWidth === "number" ? nextWidth : node.getBoundingClientRect().width;
            setContainerWidth((current) => (current === width ? current : width));
        };

        updateWidth();
        const observer = new ResizeObserver((entries) => {
            updateWidth(entries[0]?.contentRect.width);
        });
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (tasks.length <= previewLimit) {
            setShowAll(false);
        }
    }, [previewLimit, tasks.length]);

    const mode = useMemo(
        () => getFocusStripMode(tasks.length, containerWidth),
        [containerWidth, tasks.length],
    );
    const visibleTasks = useMemo(
        () => (showAll ? tasks : tasks.slice(0, previewLimit)),
        [previewLimit, showAll, tasks],
    );
    const hiddenCount = Math.max(0, tasks.length - previewLimit);
    const collapsedPreviewTask = tasks[0] ?? null;
    const collapsedRemainingCount = Math.max(0, tasks.length - 1);
    const bodyTransition = reduceMotion
        ? { duration: 0 }
        : {
            height: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
            opacity: { duration: 0.14, ease: "easeOut" },
        };

    if (tasks.length === 0) return null;

    return (
        <div
            ref={containerRef}
            className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
            <button
                type="button"
                onClick={() => setExpanded((current) => !current)}
                aria-expanded={expanded}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
            >
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    <Icon className={`w-4 h-4 ${iconColorClass}`} />
                    {title}
                </div>
                <div className="flex items-center gap-2">
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800">
                        {tasks.length}
                    </span>
                    {expanded ? (
                        <ChevronUp className="w-4 h-4 text-zinc-400" />
                    ) : (
                        <ChevronDown className="w-4 h-4 text-zinc-400" />
                    )}
                </div>
            </button>

            <AnimatePresence initial={false} mode="wait">
                {expanded ? (
                    <motion.div
                        key="expanded"
                        initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                        animate={reduceMotion ? { opacity: 1 } : { height: "auto", opacity: 1 }}
                        exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                        transition={bodyTransition}
                        className="overflow-hidden border-t border-zinc-100 dark:border-zinc-800"
                    >
                        <div className="space-y-2 px-4 py-3">
                            {visibleTasks.map((task) => {
                                const descriptionClamp = getFocusDescriptionLineClamp(mode, tasks.length, task.description);

                                return (
                                    <div
                                        key={task.id}
                                        onClick={() => onTaskClick(task)}
                                        className={cn(
                                            "group flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-transparent transition-all hover:border-zinc-200 hover:bg-zinc-50 dark:hover:border-zinc-700 dark:hover:bg-zinc-800",
                                            mode === "comfortable" ? "p-3" : "p-2.5",
                                        )}
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="line-clamp-2 text-sm font-medium leading-snug text-zinc-800 dark:text-zinc-200">
                                                {task.title}
                                            </div>
                                            {descriptionClamp > 0 ? (
                                                <div
                                                    className={cn(
                                                        "mt-1 text-xs text-zinc-500 dark:text-zinc-400",
                                                        descriptionClamp === 1 ? "line-clamp-1" : "line-clamp-2",
                                                    )}
                                                >
                                                    {task.description}
                                                </div>
                                            ) : null}
                                            <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                                <FocusUrgencyChip task={task} />
                                                <TaskStatusBadge status={task.status} className="text-[10px]" />
                                                <TaskPriorityBadge priority={task.priority} className="text-[10px]" />
                                            </div>
                                        </div>
                                        {renderTaskAction ? (
                                            <div onClick={(event) => event.stopPropagation()}>
                                                {renderTaskAction(task)}
                                            </div>
                                        ) : null}
                                    </div>
                                );
                            })}

                            {tasks.length > previewLimit ? (
                                <button
                                    type="button"
                                    onClick={() => setShowAll((current) => !current)}
                                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                                >
                                    {showAll ? "Show less" : `Show ${hiddenCount} more`}
                                </button>
                            ) : null}
                        </div>
                    </motion.div>
                ) : collapsedPreviewTask ? (
                    <motion.div
                        key="collapsed"
                        initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                        animate={reduceMotion ? { opacity: 1 } : { height: "auto", opacity: 1 }}
                        exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                        transition={bodyTransition}
                        className="overflow-hidden border-t border-zinc-100 dark:border-zinc-800"
                    >
                        <div className="px-4 py-3">
                            <div
                                onClick={() => onTaskClick(collapsedPreviewTask)}
                                className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-transparent p-2.5 transition-all hover:border-zinc-200 hover:bg-zinc-50 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="line-clamp-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                                        {collapsedPreviewTask.title}
                                    </div>
                                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                        <FocusUrgencyChip task={collapsedPreviewTask} />
                                        <TaskStatusBadge status={collapsedPreviewTask.status} className="text-[10px]" />
                                        <TaskPriorityBadge priority={collapsedPreviewTask.priority} className="text-[10px]" />
                                    </div>
                                </div>
                                {collapsedRemainingCount > 0 ? (
                                    <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
                                        +{collapsedRemainingCount} more
                                    </span>
                                ) : null}
                            </div>
                        </div>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
