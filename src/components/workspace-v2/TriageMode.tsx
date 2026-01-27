"use client";

import { memo } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform } from "framer-motion";
import {
    MessageSquare,
    FileText,
    AlertCircle,
    Check,
    Clock,
    Archive,
    Info as InfoIcon
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceData, InboxItem } from "./useWorkspaceData";

const typeConfig = {
    task: { icon: Check, color: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400" },
    mention: { icon: MessageSquare, color: "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400" },
    approval: { icon: FileText, color: "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400" },
    alert: { icon: AlertCircle, color: "bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400" },
    info: { icon: InfoIcon, color: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" }
};

function InboxCard({ item, onSwipe }: { item: InboxItem; onSwipe: (id: string, action: 'complete' | 'snooze') => void }) {
    const x = useMotionValue(0);
    const opacity = useTransform(x, [-100, 0, 100], [0.5, 1, 0.5]);

    const handleDragEnd = () => {
        if (x.get() > 100) onSwipe(item.id, 'complete');
        else if (x.get() < -100) onSwipe(item.id, 'snooze');
    };

    const Icon = typeConfig[item.type]?.icon || InfoIcon;
    const colorClass = typeConfig[item.type]?.color || typeConfig.info.color;

    return (
        <motion.div
            style={{ x, opacity }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            onDragEnd={handleDragEnd}
            className="relative group cursor-grab active:cursor-grabbing mb-3"
        >
            <div className="relative bg-white dark:bg-zinc-800 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm hover:shadow-md transition-all">
                <div className="flex items-start gap-3">
                    <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0", colorClass)}>
                        <Icon size={16} />
                    </div>

                    <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                            <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 leading-tight">
                                {item.title}
                            </h4>
                            <span className="text-[10px] text-zinc-400 font-mono flex-shrink-0">
                                {item.time}
                            </span>
                        </div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 line-clamp-2">
                            {item.subtitle}
                        </p>
                    </div>
                </div>
            </div>
        </motion.div>
    );
}

function TriageMode() {
    const { inbox, markNotificationRead, isLoading } = useWorkspaceData();

    const handleSwipe = (id: string, action: 'complete' | 'snooze') => {
        if (action === 'complete') {
            markNotificationRead(id);
        } else {
            console.log('Snoozed', id);
        }
    };

    return (
        <div className="h-full flex flex-col">
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">
                    Unified Inbox
                </h3>
                <span className="text-xs text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded-md">
                    {inbox.length} pending
                </span>
            </div>

            <div className="flex-1 space-y-1 overflow-y-auto -mr-2 pr-2">
                {isLoading ? (
                    <div className="flex justify-center py-8">
                        <div className="w-5 h-5 border-2 border-zinc-300 border-t-indigo-500 rounded-full animate-spin" />
                    </div>
                ) : (
                    <AnimatePresence>
                        {inbox.map(item => (
                            <InboxCard key={item.id} item={item} onSwipe={handleSwipe} />
                        ))}
                    </AnimatePresence>
                )}

                {!isLoading && inbox.length === 0 && (
                    <div className="h-64 flex flex-col items-center justify-center text-center text-zinc-400">
                        <div className="w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mb-4">
                            <Archive size={32} className="opacity-50" />
                        </div>
                        <p className="font-medium">Inbox Zero</p>
                        <p className="text-sm mt-1">You&apos;re all caught up!</p>
                    </div>
                )}
            </div>

            {/* Keyboard Hint */}
            <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800 text-center shrink-0">
                <p className="text-[10px] text-zinc-400">
                    Tip: Swipe right to complete, left to snooze
                </p>
            </div>
        </div>
    );
}

export default memo(TriageMode);
