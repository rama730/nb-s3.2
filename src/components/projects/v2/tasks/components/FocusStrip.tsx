import React, { useState } from "react";
import { ChevronDown, ChevronUp, LucideIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Task } from "../TaskCard";
import { useReducedMotionPreference } from "@/components/providers/theme-provider";

interface FocusStripProps {
    title: string;
    icon: LucideIcon;
    iconColorClass: string;
    tasks: Task[];
    onTaskClick: (task: Task) => void;
    renderTaskAction?: (task: Task) => React.ReactNode;
}

export default function FocusStrip({ 
    title, 
    icon: Icon, 
    iconColorClass, 
    tasks, 
    onTaskClick,
    renderTaskAction 
}: FocusStripProps) {
    const reduceMotion = useReducedMotionPreference();
    const [expanded, setExpanded] = useState(true);

    if (tasks.length === 0) return null;

    return (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
            >
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    <Icon className={`w-4 h-4 ${iconColorClass}`} />
                    {title}
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500 font-medium bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full">
                        {tasks.length}
                    </span>
                    {expanded ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
                </div>
            </button>
            
            <AnimatePresence initial={!reduceMotion}>
                {expanded && (
                    <motion.div 
                        initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                        animate={reduceMotion ? { opacity: 1 } : { height: "auto", opacity: 1 }}
                        exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                        transition={reduceMotion ? { duration: 0 } : undefined}
                        className="px-4 pb-4 space-y-2"
                    >
                        {tasks.map(task => (
                            <div 
                                key={task.id} 
                                onClick={() => onTaskClick(task)} 
                                className="flex items-center justify-between p-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-lg cursor-pointer transition-all border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700 group"
                            >
                                <div>
                                    <div className="font-medium text-sm text-zinc-800 dark:text-zinc-200">{task.title}</div>
                                    <div className="text-xs text-zinc-500 mt-1 capitalize flex items-center gap-2">
                                        <span className={task.status === 'done' ? 'text-emerald-600' : task.status === 'in_progress' ? 'text-blue-600' : ''}>
                                            {task.status.replace('_', ' ')}
                                        </span>
                                        <span className="w-1 h-1 rounded-full bg-zinc-300 dark:bg-zinc-600" />
                                        {task.priority}
                                    </div>
                                </div>
                                {renderTaskAction && (
                                    <div onClick={(e) => e.stopPropagation()}>
                                        {renderTaskAction(task)}
                                    </div>
                                )}
                            </div>
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
