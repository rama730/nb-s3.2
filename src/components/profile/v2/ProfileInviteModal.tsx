"use client";

import { useState, useEffect } from "react";
import { Loader2, Check, Send } from "lucide-react";
import { toast } from "sonner";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getProjectInviteOptionsAction } from "@/app/actions/applications";
import { sendStructuredMessageActionV2 } from "@/app/actions/messaging";
import { getProfileToRoleAlignmentAction, type AttributeAlignment } from "@/app/actions/matchmaking/resolver";

interface OpenRoleOption {
    id: string;
    title: string;
    role: string;
    filled: number;
    count: number;
}

interface ProfileInviteModalProps {
    isOpen: boolean;
    onClose: () => void;
    profileId: string;
    profileName: string;
    projects: { id: string; title: string; slug: string | null }[];
}

export default function ProfileInviteModal({
    isOpen,
    onClose,
    profileId,
    profileName,
    projects,
}: ProfileInviteModalProps) {
    const [selectedProjectId, setSelectedProjectId] = useState("");
    const [openRoles, setOpenRoles] = useState<OpenRoleOption[]>([]);
    const [selectedRoleId, setSelectedRoleId] = useState("");
    const [loadingRoles, setLoadingRoles] = useState(false);
    
    const [note, setNote] = useState("");
    const [alignment, setAlignment] = useState<AttributeAlignment | null>(null);
    const [sending, setSending] = useState(false);

    // Auto-select first project if available
    useEffect(() => {
        if (isOpen && projects.length > 0 && !selectedProjectId) {
            setSelectedProjectId(projects[0]!.id);
        }
    }, [isOpen, projects, selectedProjectId]);

    // Load open roles when selected project changes
    useEffect(() => {
        if (!isOpen || !selectedProjectId) {
            setOpenRoles([]);
            setSelectedRoleId("");
            return;
        }

        async function loadRoles() {
            setLoadingRoles(true);
            try {
                const result = await getProjectInviteOptionsAction(selectedProjectId);
                if (result.success) {
                    const rolesList = result.openRoles || [];
                    setOpenRoles(rolesList);
                    if (rolesList.length > 0) {
                        setSelectedRoleId(rolesList[0]!.id);
                    } else {
                        setSelectedRoleId("");
                    }
                } else {
                    toast.error(result.error || "Failed to load roles");
                }
            } catch (error) {
                console.error("Error loading project roles:", error);
                toast.error("Failed to load project roles");
            } finally {
                setLoadingRoles(false);
            }
        }

        loadRoles();
    }, [isOpen, selectedProjectId]);

    // Update note template when project or role changes
    useEffect(() => {
        if (!selectedProjectId) return;
        const matchedProj = projects.find(p => p.id === selectedProjectId);
        const projTitle = matchedProj ? matchedProj.title : "our project";
        
        let roleTitle = "a collaborator";
        if (selectedRoleId) {
            const matchedRole = openRoles.find((r) => r.id === selectedRoleId);
            if (matchedRole) {
                roleTitle = matchedRole.title;
            }
        }
        setNote(`Hey ${profileName}, I think you'd be a great fit for the ${roleTitle} role on ${projTitle}. Let's build this together!`);
    }, [selectedProjectId, selectedRoleId, openRoles, projects, profileName]);

    // Fetch alignment when role is selected
    useEffect(() => {
        if (!profileId || !selectedRoleId) {
            setAlignment(null);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const result = await getProfileToRoleAlignmentAction(profileId, selectedRoleId);
                if (!cancelled) setAlignment(result);
            } catch (err) {
                console.error("Failed to load alignment:", err);
                if (!cancelled) setAlignment(null);
            }
        })();
        return () => { cancelled = true; };
    }, [profileId, selectedRoleId]);

    const handleSend = async () => {
        if (!selectedProjectId) {
            toast.error("Please select a project");
            return;
        }

        setSending(true);
        try {
            const matchedProj = projects.find(p => p.id === selectedProjectId);
            const projTitle = matchedProj ? matchedProj.title : "Project";
            
            const matchedRole = openRoles.find((r) => r.id === selectedRoleId);
            const roleTitle = matchedRole ? matchedRole.title : "Collaborator";

            const result = await sendStructuredMessageActionV2({
                targetUserId: profileId,
                kind: "project_invite",
                projectId: selectedProjectId,
                roleId: selectedRoleId || null,
                roleTitle,
                summary: `Invitation to join ${projTitle} as ${roleTitle}`,
                note: note.trim() || null,
            });

            if (result.success) {
                toast.success("Invitation sent successfully!");
                onClose();
            } else {
                toast.error(result.error || "Failed to send invitation");
            }
        } catch (error) {
            console.error("Error submitting invitation:", error);
            toast.error("Failed to send invite");
        } finally {
            setSending(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[500px] bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-100 shadow-2xl rounded-2xl flex flex-col max-h-[90vh]">
                <DialogHeader className="pb-3 border-b border-zinc-100 dark:border-zinc-900">
                    <DialogTitle className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white flex items-center gap-2">
                        Invite to project
                    </DialogTitle>
                    <DialogDescription className="text-zinc-500 dark:text-zinc-400 text-sm">
                        Invite {profileName} to join one of your managed projects.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-grow overflow-y-auto pr-1 flex flex-col gap-4 py-4 min-h-[300px]">
                    {/* Project Selector */}
                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                            Project
                        </label>
                        <select
                            value={selectedProjectId}
                            onChange={(e) => setSelectedProjectId(e.target.value)}
                            className="w-full py-2 px-3 text-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl outline-none focus:border-zinc-300 dark:focus:border-zinc-700 text-zinc-800 dark:text-zinc-200"
                        >
                            {projects.length === 0 && (
                                <option value="">No managed projects available</option>
                            )}
                            {projects.map((proj) => (
                                <option key={proj.id} value={proj.id}>
                                    {proj.title}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Role Selector */}
                    {selectedProjectId && (
                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                                Assign Role
                            </label>
                            {loadingRoles ? (
                                <div className="flex items-center gap-2 text-zinc-500 text-xs">
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading roles...
                                </div>
                            ) : openRoles.length === 0 ? (
                                <div className="text-xs text-zinc-550 dark:text-zinc-450 italic p-1">
                                    No open roles defined in this project.
                                </div>
                            ) : (
                                <select
                                    value={selectedRoleId}
                                    onChange={(e) => setSelectedRoleId(e.target.value)}
                                    className="w-full py-2 px-3 text-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl outline-none focus:border-zinc-300 dark:focus:border-zinc-700 text-zinc-800 dark:text-zinc-200"
                                >
                                    {openRoles.map((role) => (
                                        <option key={role.id} value={role.id}>
                                            {role.title} ({role.count - role.filled} spot{(role.count - role.filled) !== 1 ? "s" : ""} left)
                                        </option>
                                    ))}
                                </select>
                            )}
                        </div>
                    )}

                    {/* Matchmaking Alignment Checklist */}
                    {alignment && (
                        <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 bg-zinc-50/50 dark:bg-zinc-900/30 space-y-2 animate-in fade-in duration-200">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Alignment Checklist</p>
                            <div className="grid grid-cols-2 gap-1.5 text-xs">
                                <div className="flex items-center gap-1.5">
                                    {alignment.commitmentMatch.aligns ? (
                                        <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                    ) : (
                                        <span className="w-3.5 h-3.5 text-zinc-400 text-center">•</span>
                                    )}
                                    <span className="text-zinc-600 dark:text-zinc-300">Commitment</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    {alignment.capacityMatch.aligns ? (
                                        <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                    ) : (
                                        <span className="w-3.5 h-3.5 text-zinc-400 text-center">•</span>
                                    )}
                                    <span className="text-zinc-600 dark:text-zinc-300">Capacity</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    {alignment.experienceMatch.aligns ? (
                                        <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                    ) : (
                                        <span className="w-3.5 h-3.5 text-zinc-400 text-center">•</span>
                                    )}
                                    <span className="text-zinc-600 dark:text-zinc-300">Experience</span>
                                </div>
                                {alignment.skillsMatch.matched.length > 0 && (
                                    <div className="flex items-center gap-1.5">
                                        <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                        <span className="text-zinc-600 dark:text-zinc-300">{alignment.skillsMatch.matched.length} skill{alignment.skillsMatch.matched.length !== 1 ? 's' : ''} matched</span>
                                    </div>
                                )}
                                {alignment.skillsMatch.missing.length > 0 && (
                                    <div className="col-span-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                                        Missing: <span className="font-medium text-amber-600 dark:text-amber-400">{alignment.skillsMatch.missing.join(', ')}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Invitation Note */}
                    {selectedProjectId && (
                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                                Invitation Note
                            </label>
                            <textarea
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                rows={4}
                                placeholder="Add a friendly note..."
                                className="w-full p-3 text-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl outline-none focus:border-zinc-300 dark:focus:border-zinc-700 text-zinc-800 dark:text-zinc-200 resize-none"
                            />
                        </div>
                    )}
                </div>

                <DialogFooter className="p-3 border-t border-zinc-100 dark:border-zinc-900 flex items-center justify-end gap-2 bg-zinc-50 dark:bg-zinc-950 shrink-0">
                    <Button
                        variant="outline"
                        onClick={onClose}
                        className="border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:text-zinc-800 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-xl"
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSend}
                        disabled={
                            sending ||
                            !selectedProjectId ||
                            projects.length === 0
                        }
                        className="bg-primary hover:bg-primary/95 text-primary-foreground font-semibold rounded-xl flex items-center gap-2"
                    >
                        {sending ? (
                            <Loader2 className="w-4.5 h-4.5 animate-spin" />
                        ) : (
                            <>
                                <Send className="w-4 h-4" />
                                Send Invitation
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
