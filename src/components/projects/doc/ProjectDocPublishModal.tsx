"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Users, FileStack, RefreshCw } from "lucide-react";
import { getDocDraftContributorsAction } from "@/app/actions/project/doc";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { StackedAvatars } from "@/components/ui/StackedAvatars";

export interface ProjectDocPublishModalProps {
    projectId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onPublish: (changeSummary: string, syncToFilesTab: boolean) => Promise<boolean>;
    isPublishing: boolean;
    "data-readme-publish-readiness-gate"?: string;
}

export function ProjectDocPublishModal({ projectId, open, onOpenChange, onPublish, isPublishing, ...rest }: ProjectDocPublishModalProps) {
    const [changeSummary, setChangeSummary] = useState("");
    const [syncToFilesTab, setSyncToFilesTab] = useState(true);
    const [contributors, setContributors] = useState<{ id: string; name: string; avatarUrl: string | null }[]>([]);
    const [loadingContributors, setLoadingContributors] = useState(false);

    useEffect(() => {
        if (open) {
            setLoadingContributors(true);
            getDocDraftContributorsAction(projectId).then(res => {
                if (res.success && res.contributors) {
                    setContributors(res.contributors);
                }
                setLoadingContributors(false);
            });
        }
    }, [open, projectId]);

    const handlePublish = async () => {
        const success = await onPublish(changeSummary, syncToFilesTab);
        if (success) {
            onOpenChange(false);
            setChangeSummary("");
        }
    };

    return (
        <Dialog open={open} onOpenChange={isPublishing ? undefined : onOpenChange}>
            <DialogContent 
                className="sm:max-w-[480px] p-0 overflow-hidden bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 shadow-xl rounded-2xl"
                data-readme-publish-readiness-gate={rest["data-readme-publish-readiness-gate"]}
            >
                <div className="p-6">
                    <DialogHeader className="mb-6">
                        <DialogTitle className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                            Publish Document
                        </DialogTitle>
                        <DialogDescription className="text-sm text-zinc-500 dark:text-zinc-400 mt-2">
                            Make your draft changes live to the rest of the team.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-6">
                        {/* Co-Authors Section */}
                        <div className="rounded-xl border border-zinc-100 bg-zinc-50/50 p-4 dark:border-zinc-800/50 dark:bg-zinc-900/30">
                            <div className="flex items-center gap-2 mb-3">
                                <Users className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Co-authors to be credited</span>
                            </div>
                            
                            {loadingContributors ? (
                                <div className="flex items-center gap-2 text-sm text-zinc-500">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Fetching contributors...
                                </div>
                            ) : contributors.length > 0 ? (
                                <div className="flex items-center gap-3">
                                    <StackedAvatars 
                                        avatars={contributors.map(c => ({ 
                                            url: c.avatarUrl, 
                                            initials: c.name?.charAt(0)?.toUpperCase() || 'U', 
                                            name: c.name 
                                        }))} 
                                        size={28}
                                        max={5}
                                    />
                                    <span className="text-xs text-zinc-500 font-medium">
                                        {contributors.length} {contributors.length === 1 ? 'person' : 'people'} contributed to this draft.
                                    </span>
                                </div>
                            ) : (
                                <p className="text-xs text-zinc-500 italic">No co-authors found for this draft.</p>
                            )}
                        </div>

                        {/* Change Summary */}
                        <div className="grid gap-2">
                            <Label htmlFor="changeSummary" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                What changed? <span className="text-zinc-400 font-normal">(Optional)</span>
                            </Label>
                            <Textarea
                                id="changeSummary"
                                placeholder="Briefly describe the updates for the version history..."
                                value={changeSummary}
                                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setChangeSummary(e.target.value)}
                                disabled={isPublishing}
                                maxLength={500}
                                rows={3}
                                className="resize-none rounded-xl bg-white dark:bg-zinc-950 focus-visible:ring-1 focus-visible:ring-blue-500"
                            />
                        </div>

                        {/* Sync Toggle Card */}
                        <label 
                            htmlFor="syncToFilesTab" 
                            className="flex items-start gap-3 rounded-xl border border-zinc-200 p-4 cursor-pointer transition hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900/50"
                        >
                            <div className="mt-1">
                                <Checkbox 
                                    id="syncToFilesTab" 
                                    checked={syncToFilesTab} 
                                    onCheckedChange={(c: boolean | 'indeterminate') => setSyncToFilesTab(!!c)} 
                                    disabled={isPublishing} 
                                    className="data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                                />
                            </div>
                            <div className="grid gap-1.5 leading-none">
                                <div className="flex items-center gap-2">
                                    <FileStack className="h-4 w-4 text-zinc-500" />
                                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                        Keep a copy synced in the Files tab
                                    </span>
                                </div>
                                <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-snug">
                                    Automatically creates or updates <code>README.md</code> in your project files. This ensures your document is accessible alongside other project documents.
                                </p>
                            </div>
                        </label>
                    </div>
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-zinc-100 bg-zinc-50/50 px-6 py-4 dark:border-zinc-800/50 dark:bg-zinc-900/20">
                    <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPublishing} className="rounded-full px-5 text-sm font-semibold">
                        Cancel
                    </Button>
                    <Button onClick={handlePublish} disabled={isPublishing} className="rounded-full px-6 text-sm font-semibold shadow-sm bg-blue-600 hover:bg-blue-700 text-white">
                        {isPublishing ? (
                            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Publishing...</>
                        ) : (
                            <><RefreshCw className="mr-2 h-4 w-4" /> Publish Version</>
                        )}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
