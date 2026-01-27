"use client";

import { memo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    CheckCircle2,
    Circle,
    Plus,
    Briefcase,
    Calendar,
    X
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceData, Habit, WorkspaceTask } from "./useWorkspaceData";
import { useWorkspace } from "./WorkspaceContext";

const STATUS_META = {
    todo: {
        label: "To do",
        className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700",
    },
    in_progress: {
        label: "In progress",
        className: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300 border-blue-200 dark:border-blue-800",
    },
    done: {
        label: "Done",
        className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
    },
} as const;

const PRIORITY_META: Record<string, { label: string; className: string }> = {
    urgent: {
        label: "Urgent",
        className: "bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300 border-rose-200 dark:border-rose-800",
    },
    high: {
        label: "High",
        className: "bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-300 border-orange-200 dark:border-orange-800",
    },
    medium: {
        label: "Medium",
        className: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 border-amber-200 dark:border-amber-800",
    },
    low: {
        label: "Low",
        className: "bg-zinc-50 text-zinc-600 dark:bg-zinc-900/30 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800",
    },
};

function HabitRow({ habit, onToggle, onDelete }: { habit: Habit; onToggle: (id: string) => void; onDelete: (id: string) => void }) {
    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: -10 }}
            className={cn(
                "group flex items-center gap-3 p-2 rounded-lg transition-all",
                "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
            )}
        >
            <button
                onClick={() => onToggle(habit.id)}
                className="text-zinc-300 dark:text-zinc-600 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors"
            >
                {habit.completed ? (
                    <CheckCircle2 size={20} className="text-indigo-500 fill-indigo-50 dark:fill-indigo-900/20" />
                ) : (
                    <Circle size={20} />
                )}
            </button>

            <span className={cn(
                "flex-1 text-sm transition-all select-none",
                habit.completed ? "text-zinc-400 line-through" : "text-zinc-700 dark:text-zinc-200"
            )}>
                {habit.title}
            </span>

            {habit.streak > 0 && (
                <span className="text-[10px] font-mono text-zinc-400 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity delay-75">
                    🔥 {habit.streak}
                </span>
            )}

            <button
                onClick={() => onDelete(habit.id)}
                className="text-zinc-200 dark:text-zinc-700 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity"
            >
                <X size={14} />
            </button>
        </motion.div>
    );
}

function ProjectTaskRow({
    task,
    onOpen,
    onStart,
    onDone,
}: {
    task: WorkspaceTask;
    onOpen: (id: string) => void;
    onStart: (id: string) => void;
    onDone: (id: string) => void;
}) {
    const statusMeta = STATUS_META[task.status] ?? STATUS_META.todo;
    const priorityKey = String(task.priority || "medium").toLowerCase();
    const priorityMeta = PRIORITY_META[priorityKey] ?? PRIORITY_META.medium;
    const next =
        task.status === "todo"
            ? { label: "Start", onClick: onStart, className: "bg-blue-600 hover:bg-blue-700 text-white" }
            : task.status === "in_progress"
                ? { label: "Done", onClick: onDone, className: "bg-emerald-600 hover:bg-emerald-700 text-white" }
                : null;

    return (
        <motion.div
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, height: 0 }}
            className="group relative flex items-start gap-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:shadow-md transition-all cursor-pointer"
            role="button"
            tabIndex={0}
            onClick={() => onOpen(task.id)}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(task.id);
                }
            }}
        >
            {/* Project Indicator Line */}
            <div className={cn("absolute left-0 top-3 bottom-3 w-1 rounded-r-full", task.projectColor)} />

            <div className="ml-2 flex-1">
                <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1 truncate max-w-[150px]">
                        {task.project}
                    </span>
                    {task.due && (
                        <span className={cn(
                            "text-[10px] font-medium px-1.5 py-0.5 rounded",
                            "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                        )}>
                            {task.due}
                        </span>
                    )}
                </div>

                <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 leading-snug">
                    {task.title}
                </h4>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border", statusMeta.className)}>
                        {statusMeta.label}
                    </span>
                    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border", priorityMeta.className)}>
                        {priorityMeta.label}
                    </span>
                </div>
            </div>

            {next && (
                <div className="flex items-center">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            next.onClick(task.id);
                        }}
                        className={cn(
                            "px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors",
                            next.className
                        )}
                        title={next.label}
                    >
                        {next.label}
                    </button>
                </div>
            )}
        </motion.div>
    );
}

function FocusMode() {
    const {
        tasks,
        habits,
        isLoading,
        toggleHabit,
        addHabit,
        removeHabit,
        startTask,
        completeTask
    } = useWorkspaceData();
    const { setActiveTask, setExpanded, setOpen } = useWorkspace();

    const [isAddingHabit, setIsAddingHabit] = useState(false);
    const [newHabitTitle, setNewHabitTitle] = useState("");

    const handleAddHabit = (e: React.FormEvent) => {
        e.preventDefault();
        if (newHabitTitle.trim()) {
            addHabit(newHabitTitle.trim());
            setNewHabitTitle("");
            setIsAddingHabit(false);
        }
    };

    return (
        <div className="flex flex-col gap-8 h-full">

            {/* --- Section 1: Daily Routine --- */}
            <div className="flex flex-col gap-2 shrink-0">
                <div className="flex items-center justify-between mb-1">
                    <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                        <Calendar size={14} />
                        Daily Routine
                    </h3>
                </div>

                <div className="bg-white/50 dark:bg-zinc-900/30 rounded-xl p-2 border border-dashed border-zinc-200 dark:border-zinc-800">
                    <div className="space-y-1">
                        <AnimatePresence mode="popLayout">
                            {habits.map(habit => (
                                <HabitRow
                                    key={habit.id}
                                    habit={habit}
                                    onToggle={toggleHabit}
                                    onDelete={removeHabit}
                                />
                            ))}
                        </AnimatePresence>
                    </div>

                    {isAddingHabit ? (
                        <form onSubmit={handleAddHabit} className="mt-2 flex gap-2">
                            <input
                                autoFocus
                                type="text"
                                value={newHabitTitle}
                                onChange={(e) => setNewHabitTitle(e.target.value)}
                                placeholder="New habit name..."
                                className="flex-1 bg-transparent text-sm border-b border-zinc-300 dark:border-zinc-700 focus:border-indigo-500 outline-none px-2 py-1"
                                onBlur={() => !newHabitTitle && setIsAddingHabit(false)}
                            />
                            <button type="submit" className="text-indigo-600 text-xs font-medium">Add</button>
                        </form>
                    ) : (
                        <button
                            onClick={() => setIsAddingHabit(true)}
                            className="mt-2 w-full flex items-center gap-2 p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-sm rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                        >
                            <Plus size={16} />
                            <span>Add habit</span>
                        </button>
                    )}
                </div>
            </div>

            {/* --- Section 2: Active Project Work --- */}
            <div className="flex flex-col gap-3 flex-1 min-h-0">
                <div className="flex items-center justify-between shrink-0">
                    <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                        <Briefcase size={14} />
                        Focus Tasks
                    </h3>
                    <span className="text-[10px] bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full text-zinc-500">
                        {tasks.length} Active
                    </span>
                </div>

                <div className="space-y-3 overflow-y-auto pr-1 -mr-2 pb-4 flex-1">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-8 text-zinc-400">
                            <div className="w-5 h-5 border-2 border-zinc-300 border-t-indigo-500 rounded-full animate-spin" />
                            <p className="text-xs mt-2">Loading tasks...</p>
                        </div>
                    ) : tasks.length === 0 ? (
                        <div className="text-center py-12 border-2 border-dashed border-zinc-100 dark:border-zinc-800 rounded-xl">
                            <p className="text-sm text-zinc-500">No active tasks assigned to you.</p>
                            <p className="text-xs text-zinc-400 mt-1">Enjoy your focus time!</p>
                        </div>
                    ) : (
                        <AnimatePresence mode="popLayout">
                            {tasks.map(task => (
                                <ProjectTaskRow
                                    key={task.id}
                                    task={task}
                                    onOpen={(id) => {
                                        setActiveTask(id);
                                        setOpen(true);
                                        setExpanded(true);
                                    }}
                                    onStart={startTask}
                                    onDone={completeTask}
                                />
                            ))}
                        </AnimatePresence>
                    )}
                </div>
            </div>

        </div>
    );
}

export default memo(FocusMode);
