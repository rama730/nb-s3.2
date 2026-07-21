"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Search, Loader2, Check, Send, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Virtuoso } from "react-virtuoso";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    getProjectInviteOptionsAction,
    acceptApplicationAction,
} from "@/app/actions/applications";
import { sendStructuredMessageActionV2 } from "@/app/actions/messaging";
import { getProfileToRoleAlignmentAction, type AttributeAlignment } from "@/app/actions/matchmaking/resolver";

interface ConnectionOption {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
    headline: string | null;
    pendingApplicationId: string | null;
    pendingApplicationRoleId: string | null;
    pendingApplicationRoleTitle?: string | null;
    pendingInvitations?: { id: string; roleId: string | null; roleTitle: string | null }[];
}

interface OpenRoleOption {
    id: string;
    title: string;
    role: string;
    filled: number;
    count: number;
}

interface InviteCollaboratorModalProps {
    isOpen: boolean;
    onClose: () => void;
    projectId: string;
    projectTitle: string;
}

export default function InviteCollaboratorModal({
    isOpen,
    onClose,
    projectId,
    projectTitle,
}: InviteCollaboratorModalProps) {
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [connections, setConnections] = useState<ConnectionOption[]>([]);
    const [openRoles, setOpenRoles] = useState<OpenRoleOption[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedConnection, setSelectedConnection] = useState<ConnectionOption | null>(null);
    const [selectedRoleId, setSelectedRoleId] = useState<string>("");
    const [note, setNote] = useState("");
    const [alignment, setAlignment] = useState<AttributeAlignment | null>(null);
    const [loadingAlignment, setLoadingAlignment] = useState(false);

    // Load options when modal is opened
    useEffect(() => {
        if (!isOpen) return;

        async function loadOptions() {
            setLoading(true);
            try {
                const result = await getProjectInviteOptionsAction(projectId);
                if (result.success) {
                    setConnections(result.connections || []);
                    setOpenRoles(result.openRoles || []);
                    // Auto-select first role if available
                    if (result.openRoles && result.openRoles.length > 0) {
                        setSelectedRoleId(result.openRoles[0]!.id);
                    }
                } else {
                    toast.error(result.error || "Failed to load invite options");
                }
            } catch (error) {
                console.error("Error loading invite options:", error);
                toast.error("An unexpected error occurred");
            } finally {
                setLoading(false);
            }
        }

        loadOptions();
        // Reset selections
        setSelectedConnection(null);
        setNote("");
        setAlignment(null);
    }, [isOpen, projectId]);

    // Fetch alignment when connection + role are selected
    useEffect(() => {
        if (!selectedConnection || !selectedRoleId) {
            setAlignment(null);
            return;
        }
        let cancelled = false;
        (async () => {
            setLoadingAlignment(true);
            try {
                const result = await getProfileToRoleAlignmentAction(selectedConnection.id, selectedRoleId);
                if (!cancelled) setAlignment(result);
            } catch (err) {
                console.error("Failed to load alignment:", err);
                if (!cancelled) setAlignment(null);
            } finally {
                if (!cancelled) setLoadingAlignment(false);
            }
        })();
        return () => { cancelled = true; };
    }, [selectedConnection?.id, selectedRoleId]);

    // Handle connection selection to prepopulate note
    const handleSelectConnection = (conn: ConnectionOption) => {
        setSelectedConnection(conn);
        
        // Find matching role title
        let roleTitle = "a collaborator";
        const matchedRole = openRoles.find((r) => r.id === selectedRoleId);
        if (matchedRole) {
            roleTitle = matchedRole.title;
        }

        const name = conn.fullName || conn.username || "builder";
        setNote(`Hey ${name}, I think you'd be a great fit for the ${roleTitle} role on ${projectTitle}. Let's build this together!`);
    };

    // Update note template when role changes
    const handleRoleChange = (roleId: string) => {
        setSelectedRoleId(roleId);
        if (selectedConnection) {
            const matchedRole = openRoles.find((r) => r.id === roleId);
            const roleTitle = matchedRole ? matchedRole.title : "a collaborator";
            const name = selectedConnection.fullName || selectedConnection.username || "builder";
            setNote(`Hey ${name}, I think you'd be a great fit for the ${roleTitle} role on ${projectTitle}. Let's build this together!`);
        }
    };

    // Filter connections based on search query
    const filteredConnections = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return connections;
        return connections.filter(
            (c) =>
                (c.fullName && c.fullName.toLowerCase().includes(query)) ||
                (c.username && c.username.toLowerCase().includes(query)) ||
                (c.headline && c.headline.toLowerCase().includes(query))
        );
    }, [connections, searchQuery]);

    // Check if the selected connection has already applied to this project/role
    const hasApplied = selectedConnection
        ? (selectedConnection.pendingApplicationId !== null && selectedConnection.pendingApplicationRoleId === selectedRoleId)
        : false;

    // Check if there is already an active pending invitation for this connection and role
    const hasPendingInvite = useMemo(() => {
        if (!selectedConnection || !selectedConnection.pendingInvitations) return false;
        return selectedConnection.pendingInvitations.some(
            (inv) => inv.roleId === selectedRoleId
        );
    }, [selectedConnection, selectedRoleId]);

    const handleSend = async () => {
        if (!selectedConnection) {
            toast.error("Please select a connection to invite");
            return;
        }

        setSending(true);
        try {
            if (hasApplied && selectedConnection.pendingApplicationId) {
                // Bypass invitation and approve application directly
                const result = await acceptApplicationAction(selectedConnection.pendingApplicationId);
                if (result.success) {
                    toast.success("Application approved successfully!");
                    onClose();
                } else {
                    toast.error(result.error || "Failed to approve application");
                }
            } else {
                // Send structured invitation message in DMs
                const matchedRole = openRoles.find((r) => r.id === selectedRoleId);
                const roleTitle = matchedRole ? matchedRole.title : "Collaborator";

                const result = await sendStructuredMessageActionV2({
                    targetUserId: selectedConnection.id,
                    kind: "project_invite",
                    projectId,
                    roleId: selectedRoleId || null,
                    roleTitle,
                    summary: `Invitation to join ${projectTitle} as ${roleTitle}`,
                    note: note.trim() || null,
                });

                if (result.success) {
                    toast.success("Invitation sent successfully!");
                    onClose();
                } else {
                    toast.error(result.error || "Failed to send invitation");
                }
            }
        } catch (error) {
            console.error("Error submitting invitation:", error);
            toast.error("Failed to complete action");
        } finally {
            setSending(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[550px] bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-100 shadow-2xl rounded-2xl flex flex-col max-h-[90vh]">
                <DialogHeader className="pb-3 border-b border-zinc-100 dark:border-zinc-900">
                    <DialogTitle className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white flex items-center gap-2">
                        Invite Collaborator
                    </DialogTitle>
                    <DialogDescription className="text-zinc-500 dark:text-zinc-400 text-sm">
                        Select a connected friend and invite them to an open role on your team.
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <div className="flex-1 min-h-[300px] flex items-center justify-center">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    </div>
                ) : openRoles.length === 0 ? (
                    <div className="flex-1 min-h-[300px] flex flex-col items-center justify-center text-center p-6 gap-3">
                        <AlertCircle className="w-12 h-12 text-zinc-500" />
                        <p className="font-semibold text-zinc-200">No open positions available</p>
                        <p className="text-zinc-500 text-sm max-w-sm">
                            Please define unfilled open roles in your Project settings before sending project invitations.
                        </p>
                    </div>
                ) : (
                    <div className="flex-grow overflow-y-auto pr-1 flex flex-col gap-4 py-4 min-h-[350px]">
                        {/* Step 1: Select Friend */}
                        <div className={`flex flex-col gap-2 ${!selectedConnection ? "flex-grow min-h-0" : ""}`}>
                            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                                1. Select Friend
                            </label>
                            
                            {!selectedConnection ? (
                                <>
                                    <div className="relative shrink-0">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                                        <input
                                            type="text"
                                            placeholder="Search connections..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="w-full pl-9 pr-4 py-2 text-sm bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl outline-none focus:border-zinc-300 dark:focus:border-zinc-700 text-zinc-800 dark:text-zinc-100 transition-colors"
                                        />
                                    </div>

                                    {/* FIXED: Added h-[280px] to prevent react-virtuoso zero-height layout collapse inside nested flex containers */}
                                    <div className="h-[280px] border border-zinc-200 dark:border-zinc-900 rounded-xl overflow-hidden">
                                        {filteredConnections.length === 0 ? (
                                            <div className="h-full flex items-center justify-center text-zinc-500 text-sm">
                                                No connected friends found.
                                            </div>
                                        ) : (
                                            <Virtuoso
                                                style={{ height: 280 }}
                                                data={filteredConnections}
                                                itemContent={(index, conn) => (
                                                    <button
                                                        key={conn.id}
                                                        onClick={() => handleSelectConnection(conn)}
                                                        className="w-full flex items-center gap-3 px-3 py-2.5 text-left border-b border-zinc-100 dark:border-zinc-900/60 hover:bg-zinc-50 dark:hover:bg-zinc-900/60 transition-colors"
                                                    >
                                                        <Avatar className="size-9 border border-zinc-200 dark:border-zinc-800">
                                                            <AvatarImage src={conn.avatarUrl || undefined} />
                                                            <AvatarFallback className="bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 text-xs">
                                                                {conn.fullName?.[0] || conn.username?.[0] || "?"}
                                                            </AvatarFallback>
                                                        </Avatar>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex items-center gap-2">
                                                                 <span className="font-semibold text-sm text-zinc-800 dark:text-zinc-200 truncate">
                                                                     {conn.fullName || conn.username}
                                                                 </span>
                                                                 {conn.username && conn.fullName && (
                                                                     <span className="text-zinc-500 text-xs truncate">
                                                                         @{conn.username}
                                                                     </span>
                                                                 )}
                                                                 <div className="ml-auto shrink-0 flex items-center gap-1.5">
                                                                     {conn.pendingApplicationId && (
                                                                         <span className="bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider text-[9px] px-1.5 py-0.5 rounded-md">
                                                                             Applied ({conn.pendingApplicationRoleTitle || "Role"})
                                                                         </span>
                                                                     )}
                                                                     {conn.pendingInvitations && conn.pendingInvitations.map((invite) => (
                                                                         <span key={invite.id} className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400 font-bold uppercase tracking-wider text-[9px] px-1.5 py-0.5 rounded-md">
                                                                             Invite Sent ({invite.roleTitle || "Role"})
                                                                         </span>
                                                                     ))}
                                                                 </div>
                                                            </div>
                                                            {conn.headline && (
                                                                <p className="text-zinc-500 dark:text-zinc-400 text-xs truncate mt-0.5">
                                                                    {conn.headline}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </button>
                                                )}
                                            />
                                        )}
                                    </div>
                                </>
                            ) : (
                                <div className="flex items-center justify-between p-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <Avatar className="size-10 border border-zinc-200 dark:border-zinc-800">
                                            <AvatarImage src={selectedConnection.avatarUrl || undefined} />
                                            <AvatarFallback className="bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 text-sm">
                                                {selectedConnection.fullName?.[0] || selectedConnection.username?.[0] || "?"}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="min-w-0">
                                            <p className="font-bold text-sm text-zinc-900 dark:text-white truncate">
                                                {selectedConnection.fullName || selectedConnection.username}
                                            </p>
                                            <p className="text-zinc-500 dark:text-zinc-400 text-xs truncate">
                                                {selectedConnection.username ? `@${selectedConnection.username}` : selectedConnection.headline}
                                            </p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setSelectedConnection(null)}
                                        className="text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-white"
                                    >
                                        Change
                                    </Button>
                                </div>
                            )}
                        </div>

                        {/* Step 2: Role and Composer (only visible after selecting connection) */}
                        {selectedConnection && (
                            <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-2 duration-200">
                                <div className="flex flex-col gap-2">
                                    <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                                        2. Assign Role
                                    </label>
                                    <select
                                        value={selectedRoleId}
                                        onChange={(e) => handleRoleChange(e.target.value)}
                                        className="w-full py-2 px-3 text-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl outline-none focus:border-zinc-300 dark:focus:border-zinc-700 text-zinc-800 dark:text-zinc-200"
                                    >
                                        {openRoles.map((role) => (
                                            <option key={role.id} value={role.id} className="bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200">
                                                {role.title} ({role.count - role.filled} spot{(role.count - role.filled) !== 1 ? "s" : ""} left)
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {hasPendingInvite && (
                                    <div className="flex items-start gap-2.5 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded-xl text-amber-700 dark:text-amber-300 animate-in fade-in duration-200">
                                        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                                        <div className="text-xs space-y-1">
                                            <p className="font-semibold">Invitation already pending</p>
                                            <p className="text-amber-600/80 dark:text-amber-400/80">An invitation for this role is already active.</p>
                                        </div>
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

                                <div className="flex flex-col gap-2">
                                    <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                                        3. Invitation Note
                                    </label>
                                    <textarea
                                        value={note}
                                        onChange={(e) => setNote(e.target.value)}
                                        rows={4}
                                        placeholder="Add a friendly note..."
                                        className="w-full p-3 text-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl outline-none focus:border-zinc-300 dark:focus:border-zinc-700 text-zinc-800 dark:text-zinc-200 resize-none"
                                    />
                                    {hasApplied && (
                                        <p className="text-[11px] text-zinc-500">
                                            Note: This builder has already applied to your project. Sending will immediately approve them.
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

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
                            !selectedConnection ||
                            hasPendingInvite ||
                            (!hasApplied && !selectedRoleId)
                        }
                        className="bg-primary hover:bg-primary/95 text-primary-foreground font-semibold rounded-xl flex items-center gap-2"
                    >
                        {sending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : hasPendingInvite ? (
                            <>
                                <AlertCircle className="w-4 h-4" />
                                Invitation Pending
                            </>
                        ) : hasApplied ? (
                            <>
                                <Check className="w-4 h-4" />
                                Approve Application
                            </>
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