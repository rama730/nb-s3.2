"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Briefcase, Clock3, Info, Link2, Loader2, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";
import { applyToRoleAction } from "@/app/actions/applications";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

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
    project: ProjectRef;
    roles: ProjectRole[];
    preselectedRoleId?: string;
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

export default function ApplyRoleModal({
    isOpen,
    onClose,
    onSuccess,
    project,
    roles,
    preselectedRoleId,
}: ApplyRoleModalProps) {
    const [roleId, setRoleId] = useState("");
    const [message, setMessage] = useState("");
    const [portfolioUrl, setPortfolioUrl] = useState("");
    const [availability, setAvailability] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [keyboardInset, setKeyboardInset] = useState(0);
    const messageRef = useRef<HTMLTextAreaElement | null>(null);
    const hasUserSelectedRole = useRef(false);
    const draftStorageKey = useMemo(() => `apply-role-draft:${project.id}`, [project.id]);

    const roleOptions = useMemo(() => {
        return (roles || []).map((role) => {
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
    }, [roles]);

    const selectedRole = useMemo(() => {
        return roleOptions.find((role) => role.id === roleId) || null;
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
            ? roleOptions.find((role) => role.id === preselectedRoleId && !role.disabled)
            : null;

        if (preselected) {
            setRoleId(preselected.id);
            return;
        }

        const firstOpenRole = roleOptions.find((role) => !role.disabled);
        setRoleId(firstOpenRole?.id || "");
    }, [isOpen, preselectedRoleId, roleOptions]);

    useEffect(() => {
        if (!isOpen || typeof window === "undefined") return;
        try {
            const raw = window.localStorage.getItem(draftStorageKey);
            if (!raw) return;
            const parsed = JSON.parse(raw) as {
                roleId?: string;
                message?: string;
                portfolioUrl?: string;
                availability?: string;
                savedAt?: number;
            };
            if (!parsed?.savedAt || Date.now() - parsed.savedAt > DRAFT_STORAGE_TTL_MS) {
                window.localStorage.removeItem(draftStorageKey);
                return;
            }
            if (!preselectedRoleId && parsed.roleId) {
                hasUserSelectedRole.current = true;
                setRoleId(parsed.roleId);
            }
            if (parsed.message) setMessage(parsed.message.slice(0, MAX_MESSAGE_LENGTH));
            if (parsed.portfolioUrl) setPortfolioUrl(parsed.portfolioUrl);
            if (parsed.availability) setAvailability(parsed.availability);
        } catch {
            window.localStorage.removeItem(draftStorageKey);
        }
    }, [draftStorageKey, isOpen, preselectedRoleId]);

    useEffect(() => {
        if (!isOpen) return;
        const timer = window.setTimeout(() => {
            messageRef.current?.focus();
            adjustMessageHeight();
        }, 130);
        return () => window.clearTimeout(timer);
    }, [isOpen, adjustMessageHeight]);

    useEffect(() => {
        adjustMessageHeight();
    }, [message, adjustMessageHeight]);

    useEffect(() => {
        if (!isOpen) return;
        if (typeof window === "undefined" || !window.visualViewport) return;

        const viewport = window.visualViewport;
        const onViewportChange = () => {
            const offset = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
            setKeyboardInset(offset > 70 ? offset : 0);
        };

        onViewportChange();
        viewport.addEventListener("resize", onViewportChange);
        viewport.addEventListener("scroll", onViewportChange);
        return () => {
            viewport.removeEventListener("resize", onViewportChange);
            viewport.removeEventListener("scroll", onViewportChange);
            setKeyboardInset(0);
        };
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen || typeof window === "undefined") return;
        const timeoutId = window.setTimeout(() => {
            const hasAnyValue = !!(message.trim() || portfolioUrl.trim() || availability.trim());
            if (!hasAnyValue) {
                window.localStorage.removeItem(draftStorageKey);
                return;
            }
            window.localStorage.setItem(
                draftStorageKey,
                JSON.stringify({
                    roleId,
                    message: message.slice(0, MAX_MESSAGE_LENGTH),
                    portfolioUrl,
                    availability,
                    savedAt: Date.now(),
                })
            );
        }, 280);
        return () => window.clearTimeout(timeoutId);
    }, [availability, draftStorageKey, isOpen, message, portfolioUrl, roleId]);

    const resetState = () => {
        hasUserSelectedRole.current = false;
        setRoleId("");
        setMessage("");
        setPortfolioUrl("");
        setAvailability("");
        if (typeof window !== "undefined") {
            window.localStorage.removeItem(draftStorageKey);
        }
    };

    const resetAndClose = () => {
        resetState();
        onClose();
    };

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

        setIsSubmitting(true);
        try {
            const result = await applyToRoleAction(project.id, roleId, finalMessage);
            if (!result.success) {
                toast.error(result.error || "Failed to submit application");
                return;
            }

            toast.success("Application submitted successfully");
            onSuccess?.();
            resetAndClose();
        } catch (err) {
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
            <DialogContent className="w-full max-w-[calc(100%-2rem)] sm:max-w-[1120px] gap-0 overflow-hidden border-zinc-200 bg-white p-0 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 top-[50%] left-[50%] -translate-x-1/2 -translate-y-1/2 rounded-2xl max-sm:top-auto max-sm:bottom-0 max-sm:w-[calc(100%-1rem)] max-sm:max-w-none max-sm:-translate-y-0 max-sm:rounded-t-2xl max-sm:rounded-b-none">
                <div className="flex h-[80vh] flex-col sm:h-[650px]">
                    <DialogHeader className="border-b border-zinc-200 px-3 py-3 text-left dark:border-zinc-800 sm:px-5 sm:py-4">
                        <div className="flex items-start gap-3">
                            <div className="mt-0.5 rounded-lg bg-indigo-500/10 p-1.5 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300">
                                <Briefcase className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                                <DialogTitle className="text-base sm:text-lg">Apply to Join</DialogTitle>
                                <DialogDescription className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 sm:text-sm">
                                    Submit a focused application for <span className="font-semibold text-zinc-700 dark:text-zinc-200">{project.title}</span>.
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>

                    <div className="min-h-0 flex-1 sm:grid sm:grid-cols-12">
                        <aside className="hidden border-r border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-950/40 sm:col-span-5 sm:flex sm:min-h-0 sm:flex-col">
                            <div className="border-b border-zinc-200 p-3 dark:border-zinc-800">
                                <p className="text-sm font-semibold">Open Roles</p>
                                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Select the role that best matches your contribution.</p>
                            </div>
                            <div className="min-h-0 space-y-2 overflow-y-auto p-3">
                                {roleOptions.map((role) => {
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
                                            className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                                                isActive
                                                    ? "border-indigo-500 bg-indigo-500/5"
                                                    : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600"
                                            } ${role.disabled ? "cursor-not-allowed opacity-50" : ""}`}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <p className="text-sm font-semibold">{getRoleLabel(role)}</p>
                                                <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-[11px] text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
                                                    {role.remaining} open
                                                </span>
                                            </div>
                                            {role.description && (
                                                <p className="mt-1 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">{role.description}</p>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </aside>

                        <section className="min-h-0 sm:col-span-7 sm:flex sm:flex-col">
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
                                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                                    disabled={isSubmitting}
                                >
                                    {roleOptions.length === 0 && <option value="">No open roles</option>}
                                    {roleOptions.map((role) => (
                                        <option key={role.id} value={role.id} disabled={role.disabled}>
                                            {getRoleLabel(role)}{role.disabled ? " (Filled)" : ` (${role.remaining} open)`}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3 sm:px-5 sm:py-4">
                                {selectedRole ? (
                                    <div key={selectedRole.id} className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 animate-in fade-in slide-in-from-bottom-1 duration-200 dark:border-zinc-700 dark:bg-zinc-950/40">
                                        <div className="flex items-center justify-between gap-3">
                                            <p className="text-sm font-semibold">{getRoleLabel(selectedRole)}</p>
                                            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-300">
                                                {selectedRole.remaining} slot{selectedRole.remaining === 1 ? "" : "s"} available
                                            </span>
                                        </div>
                                        {selectedRole.description && (
                                            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{selectedRole.description}</p>
                                        )}
                                        {!!selectedRole.skills?.length && (
                                            <div className="mt-3 flex flex-wrap gap-1.5">
                                                {selectedRole.skills.slice(0, 6).map((skill) => (
                                                    <span key={skill} className="rounded-full border border-zinc-300 px-2 py-0.5 text-[11px] text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
                                                        {skill}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="rounded-xl border border-amber-300/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                                        No available role to apply right now.
                                    </div>
                                )}

                                <div className="space-y-2">
                                    <label htmlFor="apply-message" className="text-sm font-medium">
                                        Why are you a fit?
                                    </label>
                                    <textarea
                                        id="apply-message"
                                        ref={messageRef}
                                        value={message}
                                        onChange={(event) => setMessage(event.target.value.slice(0, MAX_MESSAGE_LENGTH))}
                                        placeholder="Describe your relevant skills, your execution style, and how you will contribute in the first week."
                                        rows={6}
                                        className="w-full max-h-[200px] min-h-[112px] resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200/60 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-indigo-500 dark:focus:ring-indigo-500/20"
                                        disabled={isSubmitting}
                                    />
                                    <div className="flex items-center justify-between">
                                        <span
                                            className={`text-[11px] ${
                                                messageWordCount >= 20
                                                    ? "text-emerald-600 dark:text-emerald-400"
                                                    : messageWordCount >= 12
                                                        ? "text-zinc-500 dark:text-zinc-400"
                                                        : "text-amber-600 dark:text-amber-400"
                                            }`}
                                        >
                                            {qualityHint}
                                        </span>
                                        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{message.length}/{MAX_MESSAGE_LENGTH}</span>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <div className="flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                                        <Sparkles className="h-3.5 w-3.5" />
                                        Quick prompts
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {MESSAGE_PROMPTS.map((prompt) => (
                                            <button
                                                key={prompt}
                                                type="button"
                                                title={prompt}
                                                onClick={() => appendPrompt(prompt)}
                                                disabled={isSubmitting}
                                                className="rounded-full border border-zinc-300 px-2.5 py-1 text-[11px] text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                                            >
                                                {prompt.length > 40 ? `${prompt.slice(0, 40)}…` : prompt}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div className="space-y-1.5">
                                        <label htmlFor="apply-portfolio" className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                                            <Link2 className="h-3.5 w-3.5" /> Portfolio / GitHub (optional)
                                        </label>
                                        <input
                                            id="apply-portfolio"
                                            value={portfolioUrl}
                                            onChange={(event) => setPortfolioUrl(event.target.value)}
                                            placeholder="https://..."
                                            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                                            disabled={isSubmitting}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label htmlFor="apply-availability" className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                                            <Clock3 className="h-3.5 w-3.5" /> Availability (optional)
                                        </label>
                                        <input
                                            id="apply-availability"
                                            value={availability}
                                            onChange={(event) => setAvailability(event.target.value)}
                                            placeholder="e.g. 15 hrs/week, evenings"
                                            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                                            disabled={isSubmitting}
                                        />
                                    </div>
                                </div>

                                <div className="rounded-lg border border-zinc-200 bg-zinc-50/80 px-3 py-2 text-[11px] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-400">
                                    <div className="flex items-start gap-2">
                                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                        <p>
                                            Your application will be sent to the project owner/admin team and mirrored in your direct conversation thread.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </section>
                    </div>

                    <DialogFooter
                        className="border-t border-zinc-200 bg-zinc-50/70 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950/40 sm:px-5 sm:py-3"
                        style={keyboardInset > 0 ? { paddingBottom: `calc(${keyboardInset}px + env(safe-area-inset-bottom))` } : undefined}
                    >
                        <div className="flex w-full items-center justify-end gap-2">
                            <Button type="button" variant="outline" onClick={resetAndClose} disabled={isSubmitting}>
                                Cancel
                            </Button>
                            <Button
                                type="button"
                                onClick={handleSubmit}
                                disabled={isSubmitting || !selectedRole || !message.trim()}
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Submitting...
                                    </>
                                ) : (
                                    <>
                                        <Users className="h-4 w-4" />
                                        Submit Application
                                    </>
                                )}
                            </Button>
                        </div>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    );
}
