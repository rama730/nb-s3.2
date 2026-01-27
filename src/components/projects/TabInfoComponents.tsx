"use client";

import { Info } from "lucide-react";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

export function TabInfoHelp({ title, content }: { title: string; content: string }) {
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
                        <Info className="w-4 h-4" />
                    </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                    <p className="font-medium mb-1">{title}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {content}
                    </p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}
