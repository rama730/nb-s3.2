"use client";

import { toast } from "sonner";
import { useDeferredValue, useState, useMemo, useEffect } from "react";
import { BookOpenText, FileText, Loader2, Plus, Search } from "lucide-react";
import { useRouter, usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { ProjectDocReferenceOptionCard } from "@/components/projects/doc/ProjectDocReferencePreview";
import {
    useProjectDocImportCandidates,
    useProjectMarkdowns,
    PROJECT_MARKDOWNS_LIST_QUERY_KEY,
    PROJECT_DOC_QUERY_KEY,
    PROJECT_DOC_DRAFT_QUERY_KEY,
} from "@/hooks/hub/useProjectDocData";
import type { ProjectDocReferenceOption } from "@/lib/projects/doc-blocks";
import { normalizeProjectDocSlug } from "@/lib/projects/doc";

export function ProjectDocLinkDialog({
    projectId,
    isOpen,
    onClose,
}: {
    projectId: string;
    isOpen: boolean;
    onClose: () => void;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const queryClient = useQueryClient();
    const [query, setQuery] = useState("");
    const deferredQuery = useDeferredValue(query);

    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [selectedFilename, setSelectedFilename] = useState<string | null>(null);
    const [linking, setLinking] = useState(false);

    // Fetch candidate files for document linking
    const candidatesQuery = useProjectDocImportCandidates(projectId, deferredQuery, isOpen && Boolean(projectId));
    const candidates = candidatesQuery.data ?? [];

    // Fetch existing documents to find already linked files and slug collisions
    const { data: markdowns = [] } = useProjectMarkdowns(projectId);

    // Reset selection when modal closes or query changes
    useEffect(() => {
        if (!isOpen) {
            setSelectedNodeId(null);
            setSelectedFilename(null);
            setQuery("");
        }
    }, [isOpen]);

    const projectSlug = useMemo(() => {
        return pathname?.split("/")[2] || "";
    }, [pathname]);

    const handleLink = async () => {
        if (!projectId || !selectedNodeId || linking) return;
        setLinking(true);

        try {
            const filename = selectedFilename || "document.md";
            let docSlug = normalizeProjectDocSlug(filename, "doc");

            // Resolve slug collisions
            const baseSlug = docSlug;
            let suffix = 2;
            while (markdowns.some((m) => m.slug === docSlug)) {
                docSlug = `${baseSlug}-${suffix}`;
                suffix++;
            }

            const { linkProjectDocAction } = await import("@/app/actions/project/doc");
            const result = await linkProjectDocAction(projectId, selectedNodeId, docSlug);

            if (result.success) {
                toast.success("File linked successfully");
                await Promise.all([
                    queryClient.invalidateQueries({ queryKey: PROJECT_MARKDOWNS_LIST_QUERY_KEY(projectId) }),
                    queryClient.invalidateQueries({ queryKey: PROJECT_DOC_DRAFT_QUERY_KEY(projectId, docSlug) }),
                    queryClient.invalidateQueries({ queryKey: PROJECT_DOC_QUERY_KEY(projectId, docSlug) })
                ]);
                onClose();
                router.push(`/projects/${projectSlug}?tab=docs&doc=${docSlug}`, { scroll: false });
            } else {
                toast.error(result.error || "Failed to link file to Document");
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "An error occurred");
        } finally {
            setLinking(false);
        }
    };

    const handleUnlink = async () => {
        if (!projectId || !selectedNodeId || linking) return;
        setLinking(true);

        try {
            const linkedDoc = markdowns.find((doc) => doc.linkedNodeId === selectedNodeId);
            if (!linkedDoc) throw new Error("Document is not linked");

            const { unlinkProjectDocAction } = await import("@/app/actions/project/doc");
            const result = await unlinkProjectDocAction(projectId, linkedDoc.slug);

            if (result.success) {
                toast.success("File unlinked successfully");
                await Promise.all([
                    queryClient.invalidateQueries({ queryKey: PROJECT_MARKDOWNS_LIST_QUERY_KEY(projectId) }),
                    queryClient.invalidateQueries({ queryKey: PROJECT_DOC_DRAFT_QUERY_KEY(projectId, linkedDoc.slug) }),
                    queryClient.invalidateQueries({ queryKey: PROJECT_DOC_QUERY_KEY(projectId, linkedDoc.slug) })
                ]);
                setSelectedNodeId(null);
                setSelectedFilename(null);
            } else {
                toast.error(result.error || "Failed to unlink file");
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "An error occurred");
        } finally {
            setLinking(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="flex max-h-[85vh] w-[95vw] max-w-lg flex-col p-6">
                <DialogHeader className="pb-2">
                    <DialogTitle>Link Existing File as Document</DialogTitle>
                    <DialogDescription>
                        Select a Markdown file from your project files to register it as a project document.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col min-h-0 flex-1">
                    {/* Search bar */}
                    <div className="relative flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950 mb-3">
                        <Search className="h-4 w-4 text-zinc-400" />
                        <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search repository files..."
                            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-500"
                        />
                    </div>

                    {/* Scrollable list of files */}
                    <div className="flex-1 overflow-y-auto pr-1 space-y-2 min-h-[200px] max-h-[350px]">
                        {candidatesQuery.isLoading ? (
                            Array.from({ length: 3 }).map((_, index) => (
                                <div key={index} className="h-12 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
                            ))
                        ) : candidatesQuery.error ? (
                            <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/20 dark:text-red-300">
                                Failed to load document files.
                            </p>
                        ) : candidates.length ? (
                            candidates.map((candidate: ProjectDocReferenceOption) => {
                                const isAlreadyLinked = markdowns.some((doc) => doc.linkedNodeId === candidate.id);
                                return (
                                    <ProjectDocReferenceOptionCard
                                        key={candidate.id}
                                        option={{
                                            ...candidate,
                                            status: isAlreadyLinked ? "Already Linked" : candidate.status,
                                        }}
                                        selected={selectedNodeId === candidate.id}
                                        onSelect={() => {
                                            setSelectedNodeId(candidate.id);
                                            setSelectedFilename(candidate.title);
                                        }}
                                    />
                                );
                            })
                        ) : (
                            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 py-8 px-4 text-center dark:border-zinc-800 min-h-[200px]">
                                <FileText className="h-8 w-8 text-zinc-400 mb-2" />
                                <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">No Markdown files found</p>
                                <p className="mt-1 text-xs text-zinc-500 max-w-xs">
                                    Upload or create a Markdown file (.md) in your project files first, then return here to link it.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => {
                                        onClose();
                                        router.push(`/projects/${projectSlug}?tab=files`);
                                    }}
                                    className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
                                >
                                    <span>Go to Files tab</span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Bottom actions tray */}
                {selectedNodeId && (
                    <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-4 dark:border-zinc-800 shrink-0">
                        {markdowns.some((doc) => doc.linkedNodeId === selectedNodeId) ? (
                            <>
                                <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                                    <BookOpenText className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400" />
                                    <span>This file is currently linked as a project Document.</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleUnlink}
                                    disabled={linking}
                                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white hover:bg-red-500 transition-colors disabled:opacity-50 shrink-0"
                                >
                                    {linking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                                    <span>Unlink Doc</span>
                                </button>
                            </>
                        ) : (
                            <>
                                <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                                    <BookOpenText className="h-3.5 w-3.5 text-blue-500 dark:text-blue-400" />
                                    <span>This file is not linked to your project Documents.</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleLink}
                                    disabled={linking}
                                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-500 transition-colors disabled:opacity-50 shrink-0"
                                >
                                    {linking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                                    <span>Link to Doc</span>
                                </button>
                            </>
                        )}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
