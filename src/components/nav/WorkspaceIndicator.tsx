"use client";

import { Briefcase, ChevronRight } from "lucide-react";
import { motion } from "framer-motion";

interface WorkspaceIndicatorProps {
    workspaceName?: string;
    onClick?: () => void;
}

export default function WorkspaceIndicator({ workspaceName = "Personal", onClick }: WorkspaceIndicatorProps) {
    return (
        <motion.button
            onClick={onClick}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors group"
        >
            <div className="flex items-center justify-center w-5 h-5 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                <Briefcase className="w-3 h-3" />
            </div>
            <span>{workspaceName}</span>
            <ChevronRight className="w-3 h-3 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors" />
        </motion.button>
    );
}
