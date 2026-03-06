"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, ArrowRightLeft } from "lucide-react";
import type { ProjectNode } from "@/lib/db/schema";
import { getFileContent } from "@/stores/filesWorkspaceStore";
import type { Change } from "diff";

interface MultiFileDiffDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    baseNode: ProjectNode | null;
    compareNode: ProjectNode | null;
}

export default function MultiFileDiffDialog({
    open,
    onOpenChange,
    baseNode,
    compareNode,
}: MultiFileDiffDialogProps) {
    const [diffParts, setDiffParts] = useState<Change[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!open || !baseNode || !compareNode) {
            setDiffParts([]);
            return;
        }

        let cancelled = false;
        setIsLoading(true);

        const baseContent = getFileContent(baseNode.projectId, baseNode.id) || "";
        const compareContent = getFileContent(compareNode.projectId, compareNode.id) || "";

        void import("diff").then(({ diffLines }) => {
            if (cancelled) return;
            const parts = diffLines(baseContent, compareContent);
            setDiffParts(parts);
            setIsLoading(false);
        });

        return () => {
            cancelled = true;
        };
    }, [open, baseNode, compareNode]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ArrowRightLeft className="w-4 h-4 text-indigo-500" />
                        Compare Files
                    </DialogTitle>
                </DialogHeader>

                <div className="flex items-center gap-4 py-2 border-b border-zinc-100 dark:border-zinc-800 text-xs font-mono">
                    <div className="flex-1 px-3 py-1 bg-rose-50 dark:bg-rose-900/10 text-rose-700 dark:text-rose-400 rounded border border-rose-100 dark:border-rose-900/30 truncate">
                        - {baseNode?.name}
                    </div>
                    <div className="flex-1 px-3 py-1 bg-emerald-50 dark:bg-emerald-900/10 text-emerald-700 dark:text-emerald-400 rounded border border-emerald-100 dark:border-emerald-900/30 truncate">
                        + {compareNode?.name}
                    </div>
                </div>

                <div className="flex-1 min-h-0 overflow-auto mt-4 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center p-20 gap-3 text-zinc-500">
                             <Loader2 className="w-6 h-6 animate-spin" />
                             <span className="text-sm">Calculating differences...</span>
                        </div>
                    ) : (
                        <pre className="text-[11px] font-mono p-4 leading-6">
                            {diffParts.map((p, idx) => (
                                <div
                                    key={idx}
                                    className={cn(
                                        "flex",
                                        p.added
                                            ? "bg-emerald-50/80 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200"
                                            : p.removed
                                                ? "bg-rose-50/80 text-rose-900 dark:bg-rose-900/20 dark:text-rose-200"
                                                : "text-zinc-600 dark:text-zinc-400 opacity-60 hover:opacity-100 transition-opacity"
                                    )}
                                >
                                    <span className="w-6 shrink-0 inline-block text-center mr-2 select-none border-r border-zinc-100 dark:border-zinc-800">
                                        {p.added ? "+" : p.removed ? "-" : " "}
                                    </span>
                                    <span className="whitespace-pre-wrap flex-1">{p.value}</span>
                                </div>
                            ))}
                        </pre>
                    )}
                </div>

                <DialogFooter className="mt-4">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Close Comparison
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// Helper for conditional classes
function cn(...classes: Array<string | false | null | undefined>) {
    return classes.filter(Boolean).join(" ");
}
