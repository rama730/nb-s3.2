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
import { getFileContent, setFileContent } from "@/stores/filesWorkspaceStore";
import { getProjectFileContent } from "@/app/actions/files/content";
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
    const [contentError, setContentError] = useState<string | null>(null);

    useEffect(() => {
        if (!open || !baseNode || !compareNode) {
            setDiffParts([]);
            setIsLoading(false);
            setContentError(null);
            return;
        }

        let cancelled = false;
        setIsLoading(true);
        setContentError(null);

        const loadNodeContent = async (node: ProjectNode): Promise<string> => {
            const cached = getFileContent(node.projectId, node.id);
            // Detached map returns "" when missing; treat non-empty or known zero-byte files as ready.
            if (cached !== "" || node.size === 0) return cached;
            const loaded = await getProjectFileContent(node.projectId, node.id);
            setFileContent(node.projectId, node.id, loaded);
            return loaded;
        };

        void Promise.all([loadNodeContent(baseNode), loadNodeContent(compareNode)])
            .then(async ([baseContent, compareContent]) => {
                const { diffLines } = await import("diff");
                if (cancelled) return;
                const parts = diffLines(baseContent, compareContent);
                setDiffParts(parts);
            })
            .catch((error) => {
                if (cancelled) return;
                console.error("Failed to compute file diff", error);
                setDiffParts([]);
                setContentError(error instanceof Error ? error.message : "Content unavailable");
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
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
                    ) : contentError ? (
                        <div className="flex flex-col items-center justify-center p-20 gap-2 text-zinc-500">
                            <span className="text-sm font-medium">Content unavailable</span>
                            <span className="text-xs text-zinc-400">{contentError}</span>
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
