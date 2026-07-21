"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Briefcase, Clock3, Info, Link2, Loader2, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";
import { applyToRoleAction } from "@/app/actions/applications";
import { useAuth } from "@/lib/hooks/use-auth";
import { logger } from "@/lib/logger";
import { get, set, del } from "idb-keyval";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { SkillList } from "@/components/skills/SkillList";

type ProjectRef = {
    id: string;
    title: string;
    slug?: string | null;
};

type ProjectRole = {
    id: string;
    role?: string | null;
    title?: string | null;
    count?: number | null;
    filled?: number | null;
    description?: string | null;
    skills?: string[] | null;
};

interface ApplyRoleModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
    project?: ProjectRef;
    roles?: ProjectRole[];
    preselectedRoleId?: string;
    candidateProjects?: { id: string; title: string; slug?: string | null; openRoles: ProjectRole[] }[];
}

const MAX_MESSAGE_LENGTH = 1200;
const MAX_FINAL_MESSAGE_LENGTH = 2000;
const DRAFT_STORAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const MESSAGE_PROMPTS = [
    "I can contribute immediately and align with your current sprint goals.",
    "I have prior experience with similar projects and team workflows.",
    "I can commit consistent weekly time and communicate progress clearly.",
];

function getRoleLabel(role: ProjectRole) {
    return role.title || role.role || "Role";
}

function getLinkTypeLabel(hostnameOrRaw: string) {
    const value = hostnameOrRaw.toLowerCase();
    if (value.includes("github.com")) return "GitHub";
    if (value.includes("linkedin.com")) return "LinkedIn";
    if (value.includes("gitlab.com")) return "GitLab";
    return "Link";
}

function formatTypedLinkLine(rawValue: string) {
    const trimmed = rawValue.trim();
    if (!trimmed) return null;

    const firstToken = trimmed.split(/\s+/)[0];
    if (!firstToken) return null;
    const candidate = /^https?:\/\//i.test(firstToken) ? firstToken : `https://${firstToken}`;

    try {
        const parsed = new URL(candidate);
        const label = getLinkTypeLabel(parsed.hostname);
        return `${label}: ${parsed.toString()}`;
    } catch {
        const label = getLinkTypeLabel(firstToken);
        return `${label}: ${trimmed}`;
    }
}

function fnv1a(str: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = (hash * 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
}

async function sha256(messageText: string): Promise<string> {
    if (typeof window !== "undefined" && window.crypto?.subtle) {
        try {
            const msgBuffer = new TextEncoder().encode(messageText);
            const hashBuffer = await window.crypto.subtle.digest("SHA-256", msgBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
        } catch (e) {
            console.warn("WebCrypto digest failed, falling back to FNV-1a", e);
        }
    }
    return fnv1a(messageText);
}

export default function ApplyRoleModal({
    isOpen,
    onClose,
    onSuccess,
    project,
    roles,
    preselectedRoleId,
    candidateProjects,
}: ApplyRoleModalProps) {
    const [selectedProjectId, setSelectedProjectId] = useState("");
    const [roleId, setRoleId] = useState("");
    const [message, setMessage] = useState("");
    const [portfolioUrl, setPortfolioUrl] = useState("");
    const [availability, setAvailability] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [keyboardInset, setKeyboardInset] = useState(0);
    const [roleSearch, setRoleSearch] = useState("");

    const { user } = useAuth();

    const currentProject = useMemo(() => {
        if (project) return project;
        if (candidateProjects) {
            return candidateProjects.find(p => p.id === selectedProjectId) || null;
        }
        return null;
    }, [project, candidateProjects, selectedProjectId]) as any;

    const currentRoles = useMemo(() => {
        if (roles) return roles;
        return currentProject?.openRoles || [];
    }, [roles, currentProject]);

    useEffect(() => {
        if (isOpen) {
            if (project?.id) {
                setSelectedProjectId(project.id);
            } else if (candidateProjects && candidateProjects.length > 0 && !selectedProjectId) {
                setSelectedProjectId(candidateProjects[0]!.id);
            }
        }
    }, [isOpen, project?.id, candidateProjects, selectedProjectId]);

    useEffect(() => {
        if (isOpen && preselectedRoleId) {
            if (candidateProjects) {
                const found = candidateProjects.find(p => p.openRoles.some(r => r.id === preselectedRoleId));
                if (found) {
                    setSelectedProjectId(found.id);
                    setRoleId(preselectedRoleId);
                }
            } else {
                setRoleId(preselectedRoleId);
            }
        }
    }, [isOpen, preselectedRoleId, candidateProjects]);

    const [showAllRoles, setShowAllRoles] = useState(false);
    const messageRef = useRef<HTMLTextAreaElement | null>(null);
    const hasUserSelectedRole = useRef(false);
    const lastLineCount = useRef(0);
    const draftStorageKey = useMemo(() => `apply-role-draft:${currentProject?.id || selectedProjectId || 'select'}`, [currentProject?.id, selectedProjectId]);

    const roleOptions = useMemo(() => {
        return (currentRoles || []).map((role: ProjectRole) => {
            const total = Number(role.count || 0);
            const filled = Number(role.filled || 0);
            const remaining = Math.max(0, total - filled);
            return {
                ...role,
                total,
                filled,
                remaining,
                disabled: remaining <= 0,
            };
        });
    }, [currentRoles]);

    const filteredRoles = useMemo(() => {
        const query = roleSearch.trim().toLowerCase();
        if (!query) return roleOptions;
        return roleOptions.filter((role: any) =>
            getRoleLabel(role).toLowerCase().includes(query)
        );
    }, [roleOptions, roleSearch]);

    const visibleRoles = useMemo(() => {
        if (showAllRoles || roleSearch.trim()) {
            return filteredRoles;
        }
        const initial = filteredRoles.slice(0, 5);
        if (roleId && !initial.some((r: any) => r.id === roleId)) {
            const selected = filteredRoles.find((r: any) => r.id === roleId);
            if (selected) {
                initial.push(selected);
            }
        }
        return initial;
    }, [filteredRoles, showAllRoles, roleSearch, roleId]);

    const selectedRole = useMemo(() => {
        return roleOptions.find((role: any) => role.id === roleId) || null;
    }, [roleId, roleOptions]);

    const messageWordCount = useMemo(() => {
        const normalized = message.trim();
        if (!normalized) return 0;
        return normalized.split(/\s+/).length;
    }, [message]);

    const qualityHint = useMemo(() => {
        if (messageWordCount === 0) return "Add a concise intro, relevant skills, and expected contribution.";
        if (messageWordCount < 12) return "Too short. Add specific outcomes and execution details.";
        if (messageWordCount < 20) return "Good start. Add first-week contribution details for stronger review.";
        return "Strong application quality.";
    }, [messageWordCount]);

    const adjustMessageHeight = useCallback(() => {
        if (!messageRef.current) return;
        messageRef.current.style.height = "auto";
        messageRef.current.style.height = `${Math.min(messageRef.current.scrollHeight, 240)}px`;
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        if (hasUserSelectedRole.current) return;

        const preselected = preselectedRoleId
            ? roleOptions.find((role: any) => role.id === preselectedRoleId && !role.disabled)
            : null;

        if (preselected) {
            setRoleId(preselected.id);
            return;
        }

        const firstOpenRole = roleOptions.find((role: any) => !role.disabled);
        setRoleId(firstOpenRole?.id || "");
    }, [isOpen, preselectedRoleId, roleOptions]);

    // Asynchronous draft loading from IndexedDB
    useEffect(() => {
        if (!isOpen) return;
        let isMounted = true;

        async function loadDraft() {
            try {
                const raw = await get(draftStorageKey);
                if (!raw || !isMounted) return;
                const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
                if (!parsed?.savedAt || Date.now() - parsed.savedAt > DRAFT_STORAGE_TTL_MS) {
                    await del(draftStorageKey);
                    return;
                }
                if (!preselectedRoleId && parsed.roleId) {
                    // Stale draft role ID check: verify role exists and is not disabled
                    const isValidRole = roleOptions.some((r: any) => r.id === parsed.roleId && !r.disabled);
                    if (isValidRole) {
                        hasUserSelectedRole.current = true;
                        setRoleId(parsed.roleId);
                    } else {
                        const firstOpenRole = roleOptions.find((role: any) => !role.disabled);
                        setRoleId(firstOpenRole?.id || "");
                    }
                }
                if (parsed.message) setMessage(parsed.message.slice(0, MAX_MESSAGE_LENGTH));
                if (parsed.portfolioUrl) setPortfolioUrl(parsed.portfolioUrl);
                if (parsed.availability) setAvailability(parsed.availability);
            } catch (err) {
                console.error("Failed to load draft:", err);
                try {
                    await del(draftStorageKey);
                } catch {}
            }
        }

        loadDraft();
        return () => {
            isMounted = false;
        };
    }, [draftStorageKey, isOpen, preselectedRoleId, roleOptions]);

    // Focus handler with synchronous timer cleanup
    useEffect(() => {
        if (!isOpen) return;
        const timer = window.setTimeout(() => {
            messageRef.current?.focus();
            adjustMessageHeight();
        }, 130);
        return () => window.clearTimeout(timer);
    }, [isOpen, adjustMessageHeight]);

    useEffect(() => {
        const lineCount = message.split("\n").length;
        if (lineCount !== lastLineCount.current) {
            lastLineCount.current = lineCount;
            adjustMessageHeight();
        }
    }, [message, adjustMessageHeight]);

    // Viewport resize calculations throttled using requestAnimationFrame
    useEffect(() => {
        if (!isOpen) return;
        if (typeof window === "undefined" || !window.visualViewport) return;

        // Only register visual viewport listeners on mobile screens to save desktop CPU cycles
        const isMobileScreen = window.innerWidth < 640 || ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
        if (!isMobileScreen) return;

        const viewport = window.visualViewport;
        let rafId: number | null = null;

        const onViewportChange = () => {
            if (rafId !== null) return;
            rafId = requestAnimationFrame(() => {
                rafId = null;
                const offset = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
                setKeyboardInset(offset > 70 ? offset : 0);
            });
        };

        onViewportChange();
        viewport.addEventListener("resize", onViewportChange);
        viewport.addEventListener("scroll", onViewportChange);
        return () => {
            viewport.removeEventListener("resize", onViewportChange);
            viewport.removeEventListener("scroll", onViewportChange);
            if (rafId !== null) {
                cancelAnimationFrame(rafId);
            }
            setKeyboardInset(0);
        };
    }, [isOpen]);

    // Asynchronous draft persistence with 1500ms debounce
    useEffect(() => {
        if (!isOpen) return;
        const timeoutId = window.setTimeout(async () => {
            const hasAnyValue = !!(message.trim() || portfolioUrl.trim() || availability.trim());
            if (!hasAnyValue) {
                try {
                    await del(draftStorageKey);
                } catch {}
                return;
            }
            try {
                await set(
                    draftStorageKey,
                    {
                        roleId,
                        message: message.slice(0, MAX_MESSAGE_LENGTH),
                        portfolioUrl,
                        availability,
                        savedAt: Date.now(),
                    }
                );
            } catch (err) {
                console.error("Failed to save draft:", err);
            }
        }, 1500);

        return () => window.clearTimeout(timeoutId);
    }, [availability, draftStorageKey, isOpen, message, portfolioUrl, roleId]);

    const resetState = useCallback(async () => {
        hasUserSelectedRole.current = false;
        setRoleId("");
        setMessage("");
        setPortfolioUrl("");
        setAvailability("");
        setShowAllRoles(false);
        try {
            await del(draftStorageKey);
        } catch {}
    }, [draftStorageKey]);

    const resetAndClose = useCallback(() => {
        resetState();
        onClose();
    }, [resetState, onClose]);

    const appendPrompt = (prompt: string) => {
        setMessage((previous) => {
            if (!previous.trim()) return prompt;
            if (previous.includes(prompt)) return previous;
            return `${previous.trim()}\n\n${prompt}`;
        });
        requestAnimationFrame(() => {
            messageRef.current?.focus();
            const end = messageRef.current?.value.length ?? 0;
            messageRef.current?.setSelectionRange(end, end);
        });
    };

    const handleSubmit = async () => {
        if (!currentProject) {
            toast.error("Please select a project first");
            return;
        }

        if (!roleId) {
            toast.error("Select a role before submitting");
            return;
        }

        const coreMessage = message.trim();
        if (!coreMessage) {
            toast.error("Please add a short application message");
            return;
        }

        const messageParts = [coreMessage];
        const typedLinkLine = formatTypedLinkLine(portfolioUrl);
        const cleanAvailability = availability.trim();

        if (typedLinkLine) {
            messageParts.push(typedLinkLine);
        }
        if (cleanAvailability) {
            messageParts.push(`Availability: ${cleanAvailability}`);
        }

        const finalMessage = messageParts.join("\n\n");
        if (finalMessage.length > MAX_FINAL_MESSAGE_LENGTH) {
            toast.error("Application text is too long. Please shorten it.");
            return;
        }

        const startedAt = performance.now();
        const requestId = `apply-submit:${currentProject.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
        setIsSubmitting(true);
        try {
            const finalMessageHash = await sha256(finalMessage);
            const idempotencyKey = `apply:${currentProject.id}:${roleId}:${finalMessageHash}`;
            
            // Introduce a 15-second client-side submission timeout race
            let timeoutId: ReturnType<typeof setTimeout> | undefined;
            const timeoutPromise = new Promise<never>((_, reject) => {
                timeoutId = setTimeout(() => {
                    reject(new Error("Request timed out. Please check your network connection and try again."));
                }, 15000);
            });

            const result = await Promise.race([
                applyToRoleAction(currentProject.id, roleId, finalMessage, {
                    idempotencyKey,
                    applyingProjectId: null,
                    applyingProjectRole: null,
                }),
                timeoutPromise
            ]);

            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            if (!result.success) {
                const durationMs = Math.round(performance.now() - startedAt);
                logger.metric("applications.apply.result", {
                    module: "project-apply-modal",
                    projectId: currentProject.id,
                    roleId,
                    idempotencyKey,
                    applicationTraceId: result.applicationTraceId || null,
                    errorCode: result.errorCode || "UNKNOWN",
                    result: "failure",
                    durationMs,
                    requestId,
                });
                logger.metric("project.detail.application.submit", {
                    interaction: "application.submit",
                    projectId: currentProject.id,
                    roleId,
                    applicationTraceId: result.applicationTraceId || null,
                    requestId,
                    durationMs,
                    result: "failure",
                    errorCode: result.errorCode || "UNKNOWN",
                });
                toast.error(result.error || "Failed to submit application");
                return;
            }

            const durationMs = Math.round(performance.now() - startedAt);
            logger.metric("applications.apply.result", {
                module: "project-apply-modal",
                projectId: currentProject.id,
                roleId,
                idempotencyKey,
                applicationTraceId: result.applicationTraceId || null,
                applicationId: result.applicationId || null,
                idempotent: !!result.idempotent,
                result: "success",
                durationMs,
                requestId,
            });
            logger.metric("project.detail.application.submit", {
                interaction: "application.submit",
                projectId: currentProject.id,
                roleId,
                applicationTraceId: result.applicationTraceId || null,
                applicationId: result.applicationId || null,
                idempotent: !!result.idempotent,
                requestId,
                durationMs,
                result: "success",
            });
            toast.success("Application submitted successfully");
            onSuccess?.();
            resetAndClose();
        } catch (err) {
            const durationMs = Math.round(performance.now() - startedAt);
            logger.metric("project.detail.application.submit", {
                interaction: "application.submit",
                projectId: currentProject.id,
                roleId,
                requestId,
                durationMs,
                result: "failure",
                errorCode: "UNEXPECTED_ERROR",
                message: err instanceof Error ? err.message : "Unknown error",
            });
            console.error("Apply to role failed:", err);
            toast.error(err instanceof Error ? err.message : "Something went wrong");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog
            open={isOpen}
            onOpenChange={(open) => {
                if (!open && !isSubmitting) resetAndClose();
            }}
        >
            <DialogContent className="w-full max-w-[calc(100%-2rem)] sm:max-w-[1120px] gap-0 overflow-hidden border-zinc-200 bg-white p-0 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 top-[50%] left-[50%] -translate-x-1/2 -translate-y-1/2 rounded-2xl max-sm:top-auto max-sm:bottom-0 max-sm:w-[calc(100%-1rem)] max-sm:max-w-none max-sm:-translate-y-0 max-sm:rounded-t-2xl max-sm:rounded-b-none">
                <div className="flex h-[80vh] flex-col sm:h-[650px]">
                    <DialogHeader className="border-b border-zinc-200 px-3 py-3.5 text-left dark:border-zinc-800 sm:px-5 sm:py-4.5">
                        <div className="flex items-start gap-3">
                            <div className="mt-0.5 rounded-lg p-1.5 text-primary bg-primary/10">
                                <Briefcase className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                                <DialogTitle className="text-base sm:text-lg">Apply to Join</DialogTitle>
                                <DialogDescription className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 sm:text-sm">
                                    Submit a focused application {currentProject ? <>for <span className="font-semibold text-zinc-700 dark:text-zinc-200">{currentProject.title}</span></> : "to join a project"}.
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>

                    <div className="min-h-0 flex-1 sm:grid sm:grid-cols-12">
                        <aside className="hidden border-r border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-950/20 sm:col-span-5 sm:flex sm:min-h-0 sm:flex-col">
                            <div className="border-b border-zinc-200 p-3.5 dark:border-zinc-800 flex flex-col gap-2">
                                <div>
                                    <p className="text-sm font-semibold text-zinc-850 dark:text-zinc-200">Open Roles</p>
                                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Select the role that best matches your contribution.</p>
                                </div>
                                {roleOptions.length > 5 && (
                                    <input
                                        type="text"
                                        placeholder="Search roles..."
                                        value={roleSearch}
                                        onChange={(e) => setRoleSearch(e.target.value)}
                                        className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:border-primary/60  "
                                    />
                                )}
                            </div>
                            <div className="min-h-0 divide-y divide-zinc-100 dark:divide-zinc-800/60 overflow-y-auto px-2 py-1">
                                {visibleRoles.length === 0 ? (
                                    <div className="p-5 text-center text-xs text-zinc-550 dark:text-zinc-450">
                                        {!selectedProjectId ? "Select a project first." : "No open roles in this project."}
                                    </div>
                                ) : visibleRoles.map((role: any) => {
                                    const isActive = role.id === roleId;
                                    return (
                                        <button
                                            key={role.id}
                                            type="button"
                                            onClick={() => {
                                                hasUserSelectedRole.current = true;
                                                setRoleId(role.id);
                                            }}
                                            disabled={role.disabled || isSubmitting}
                                            className={`w-full flex flex-col justify-start py-3 px-3.5 text-left border-l-2 transition-all duration-150 ${
                                                isActive
                                                    ? "border-primary bg-primary/5 dark:bg-primary/10"
                                                    : "border-transparent hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                                            } ${role.disabled ? "cursor-not-allowed opacity-50" : ""}`}
                                        >
                                            <div className="flex items-start justify-between gap-3 w-full">
                                                <p className={`text-sm font-semibold transition-colors ${
                                                    isActive ? "text-primary" : "text-zinc-850 dark:text-zinc-200"
                                                }`}>{getRoleLabel(role)}</p>
                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200/60 dark:border-zinc-700/60 shrink-0">
                                                    {role.remaining} open
                                                </span>
                                            </div>
                                            {role.description && (
                                                <p className="mt-1 line-clamp-1 text-xs text-zinc-500 dark:text-zinc-400 w-full">{role.description}</p>
                                            )}
                                        </button>
                                    );
                                })}
                                {filteredRoles.length > visibleRoles.length && (
                                    <div className="py-2.5 px-3.5 flex justify-center border-t border-zinc-100 dark:border-zinc-800/60 bg-zinc-50/20 dark:bg-zinc-950/10">
                                        <button
                                            type="button"
                                            onClick={() => setShowAllRoles(true)}
                                            className="text-xs font-bold text-primary hover:underline transition-colors"
                                        >
                                            + {filteredRoles.length - visibleRoles.length} more roles
                                        </button>
                                    </div>
                                )}
                            </div>
                        </aside>

                        <section className="min-h-0 sm:col-span-7 sm:flex sm:flex-col">
                            {candidateProjects && candidateProjects.length > 0 && (
                                <div className="border-b border-zinc-200 px-3 py-3.5 dark:border-zinc-800 sm:px-5">
                                    <label htmlFor="apply-project-select" className="mb-1 block text-xs font-semibold text-zinc-655 dark:text-zinc-355">
                                        Project
                                    </label>
                                    <select
                                        id="apply-project-select"
                                        value={selectedProjectId}
                                        onChange={(e) => {
                                            setSelectedProjectId(e.target.value);
                                            setRoleId("");
                                        }}
                                        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950 focus:outline-none focus:border-primary/60  "
                                        disabled={isSubmitting}
                                    >
                                        <option value="">Select a project...</option>
                                        {candidateProjects.map((p) => (
                                            <option key={p.id} value={p.id}>
                                                {p.title}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div className="border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800 sm:hidden">
                                <label htmlFor="apply-role-mobile" className="mb-1 block text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                                    Role
                                </label>
                                <select
                                    id="apply-role-mobile"
                                    value={roleId}
                                    onChange={(event) => {
                                        hasUserSelectedRole.current = true;
                                        setRoleId(event.target.value);
                                    }}
                                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950 focus:outline-none focus:border-primary/60  "
                                    disabled={isSubmitting}
                                >
                                    {roleOptions.length === 0 && <option value="">No open roles</option>}
                                    {roleOptions.map((role: any) => (
                                        <option key={role.id} value={role.id} disabled={role.disabled}>
                                            {getRoleLabel(role)}{role.disabled ? " (Filled)" : ` (${role.remaining} open)`}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3 sm:px-5 sm:py-4.5">
                                {selectedRole ? (
                                    <div key={selectedRole.id} className="py-1 animate-in fade-in slide-in-from-bottom-1 duration-200">
                                        <div className="flex items-center gap-2 mb-1.5">
                                            <p className="text-sm font-semibold text-zinc-850 dark:text-zinc-100">{getRoleLabel(selectedRole)}</p>
                                            <span className="text-zinc-400 dark:text-zinc-500 shrink-0 select-none">·</span>
                                            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                                {selectedRole.remaining} slot{selectedRole.remaining === 1 ? "" : "s"} available
                                            </span>
                                        </div>
                                        {selectedRole.description && (
                                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">{selectedRole.description}</p>
                                        )}
                                        {!!selectedRole.skills?.length && (
                                            <SkillList skills={selectedRole.skills} maxVisible={6} size="sm" />
                                        )}
                                    </div>
                                ) : (
                                    <div className="rounded-xl border border-amber-250 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                                        No available role to apply right now.
                                    </div>
                                )}



                                <div className="space-y-2">
                                    <label htmlFor="apply-message" className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                                        Why are you a fit?
                                    </label>
                                    <textarea
                                        id="apply-message"
                                        ref={messageRef}
                                        value={message}
                                        onChange={(event) => setMessage(event.target.value.slice(0, MAX_MESSAGE_LENGTH))}
                                        placeholder="Describe your relevant skills, your execution style, and how you will contribute in the first week."
                                        rows={6}
                                        className="w-full max-h-[200px] min-h-[112px] resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-primary/60   dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-primary/50 dark: focus:outline-none"
                                        disabled={isSubmitting}
                                    />
                                    <div className="flex items-center justify-between">
                                        <span
                                            className={`text-[11px] font-medium ${
                                                messageWordCount >= 20
                                                    ? "text-emerald-600 dark:text-emerald-400"
                                                    : messageWordCount >= 12
                                                        ? "text-zinc-500 dark:text-zinc-400"
                                                        : "text-amber-600 dark:text-amber-450"
                                            }`}
                                        >
                                            {qualityHint}
                                        </span>
                                        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{message.length}/{MAX_MESSAGE_LENGTH}</span>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <div className="flex items-center gap-2 text-xs font-semibold text-zinc-600 dark:text-zinc-350">
                                        <Sparkles className="h-3.5 w-3.5" />
                                        Quick prompts
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {MESSAGE_PROMPTS.map((prompt) => (
                                            <button
                                                key={prompt}
                                                type="button"
                                                title={prompt}
                                                onClick={() => appendPrompt(prompt)}
                                                disabled={isSubmitting}
                                                className="rounded-full border border-zinc-250 bg-zinc-50/50 hover:bg-zinc-100 hover:border-zinc-350 dark:border-zinc-800 dark:bg-zinc-900/40 dark:hover:bg-zinc-800 px-2.5 py-1 text-[11px] text-zinc-650 dark:text-zinc-400 dark:hover:text-zinc-300 transition-all duration-150"
                                            >
                                                {prompt.length > 40 ? `${prompt.slice(0, 40)}…` : prompt}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div className="space-y-1.5">
                                        <label htmlFor="apply-portfolio" className="flex items-center gap-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-350">
                                            <Link2 className="h-3.5 w-3.5" /> Portfolio / GitHub (optional)
                                        </label>
                                        <input
                                            id="apply-portfolio"
                                            value={portfolioUrl}
                                            onChange={(event) => setPortfolioUrl(event.target.value)}
                                            placeholder="https://..."
                                            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-primary/60   dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-primary/50 dark: focus:outline-none"
                                            disabled={isSubmitting}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label htmlFor="apply-availability" className="flex items-center gap-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-350">
                                            <Clock3 className="h-3.5 w-3.5" /> Availability (optional)
                                        </label>
                                        <input
                                            id="apply-availability"
                                            value={availability}
                                            onChange={(event) => setAvailability(event.target.value)}
                                            placeholder="e.g. 15 hrs/week, evenings"
                                            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-primary/60   dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-primary/50 dark: focus:outline-none"
                                            disabled={isSubmitting}
                                        />
                                    </div>
                                </div>

                                <div className="px-1 py-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                                    <div className="flex items-start gap-2">
                                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-455 dark:text-zinc-500" />
                                        <p>
                                            Your application will be sent to the project owner/admin team and mirrored in your direct conversation thread.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </section>
                    </div>

                    <DialogFooter
                        className="border-t border-zinc-200 bg-zinc-50/50 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950/20 sm:px-5 sm:py-3.5"
                        style={keyboardInset > 0 ? { paddingBottom: `calc(${keyboardInset}px + env(safe-area-inset-bottom))` } : undefined}
                    >
                        <div className="flex w-full items-center justify-end gap-2.5">
                            <button
                                type="button"
                                onClick={resetAndClose}
                                disabled={isSubmitting}
                                className="px-4 py-2 text-xs font-semibold rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all duration-150 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleSubmit}
                                disabled={isSubmitting || !selectedRole || !message.trim()}
                                className="px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:brightness-110 transition-all duration-150 disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        Submitting...
                                    </>
                                ) : (
                                    <>
                                        <Users className="h-3.5 w-3.5" />
                                        Submit Application
                                    </>
                                )}
                            </button>
                        </div>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    );
}
