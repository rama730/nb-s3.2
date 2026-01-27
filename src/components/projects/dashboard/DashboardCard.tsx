"use client";

import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { LucideIcon } from "lucide-react";
import { ReactNode } from "react";

interface DashboardCardProps {
    title: string;
    icon?: LucideIcon;
    badge?: ReactNode;
    action?: ReactNode;
    children: ReactNode;
    className?: string;
    compact?: boolean;
    noPadding?: boolean;
}

export default function DashboardCard({
    title,
    icon: Icon,
    badge,
    action,
    children,
    className,
    compact,
    noPadding
}: DashboardCardProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
                "rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm hover:shadow-xl transition-shadow duration-300",
                className
            )}
        >
            <div className={cn(
                "flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800",
                compact ? "px-3 py-2.5" : "px-4 py-3"
            )}>
                <div className="flex items-center gap-2.5">
                    {Icon && (
                        <div className="p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                            <Icon className="w-4 h-4" />
                        </div>
                    )}
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {title}
                    </h3>
                    {badge}
                </div>
                {action}
            </div>
            <div className={cn(noPadding ? "" : compact ? "p-3" : "p-4")}>
                {children}
            </div>
        </motion.div>
    );
}
