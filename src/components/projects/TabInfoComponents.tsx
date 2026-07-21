"use client";

import { Info } from "lucide-react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

export function TabInfoHelp({ title, content }: { title: string; content: string }) {
    return (
        <TooltipPrimitive.Provider>
            <TooltipPrimitive.Root>
                <TooltipPrimitive.Trigger asChild>
                    <button className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
                        <Info className="w-4 h-4" />
                    </button>
                </TooltipPrimitive.Trigger>
                <TooltipPrimitive.Content
                    sideOffset={4}
                    className="z-50 max-w-xs overflow-hidden rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-950 shadow-md dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
                >
                    <p className="font-medium mb-1">{title}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {content}
                    </p>
                </TooltipPrimitive.Content>
            </TooltipPrimitive.Root>
        </TooltipPrimitive.Provider>
    );
}
