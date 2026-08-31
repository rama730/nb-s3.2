"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Briefcase, Check, Loader2, Search, Sparkles, Users } from "lucide-react";
import { del, get, set } from "idb-keyval";
import { toast } from "sonner";
import { Virtuoso } from "react-virtuoso";

import { applyToRoleAction, getProjectInviteOptionsAction } from "@/app/actions/applications";
import {
    createProjectInvitationAction,
    getProjectGuidancePreflightAction,
    searchProjectInviteCandidatesAction,
} from "@/app/actions/project/guidance";
import { getProfileToRoleAlignmentAction, type AttributeAlignment } from "@/app/actions/matchmaking/resolver";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/hooks/use-auth";
import { logger } from "@/lib/logger";

export type ParticipationRole = {
    id: string;
    title?: string | null;
    role?: string | null;
    count?: number | null;
    filled?: number | null;
    description?: string | null;
    skills?: string[] | null;
};

export type ParticipationProject = {
    id: string;
    title: string;
    slug?: string | null;
    role?: "owner" | "admin";
    openRoles?: ParticipationRole[];
};

type Candidate = {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
    headline: string | null;
    state?: "eligible" | "application_pending" | "invitation_pending";
};

type InvitationKind = "ordinary_role" | "guidance_appointment";
type GuidancePreflight = { activeGuide: { label: string; name: string } | null; capacity: "available" | "warning" | "blocked" };
type CachedOptions = { roles: ParticipationRole[]; people: Candidate[] };

export interface InviteCollaboratorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
    mode?: "invite" | "apply";
    projectId?: string;
    projectTitle?: string;
    roles?: ParticipationRole[];
    projects?: ParticipationProject[];
    preselectedRoleId?: string;
    candidate?: Candidate;
    canAppointGuidance?: boolean;
}

const APPLICATION_PROMPTS = [
    "I can contribute immediately and align with your current sprint goals.",
    "I have prior experience with similar projects and team workflows.",
    "I can commit consistent weekly time and communicate progress clearly.",
];
const APPLICATION_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NOTE_LIMIT = 500;
const APPLICATION_LIMIT = 1200;

function roleLabel(role: ParticipationRole) {
    return role.title || role.role || "Role";
}

function remainingRoles(role: ParticipationRole) {
    return Math.max(0, Number(role.count ?? 0) - Number(role.filled ?? 0));
}

function displayName(candidate: Candidate) {
    return candidate.fullName || candidate.username || "Builder";
}

function queryBucket(query: string) {
    if (!query) return "empty";
    if (query.length <= 4) return "2-4";
    if (query.length <= 8) return "5-8";
    return "9+";
}

async function fingerprint(value: string) {
    if (globalThis.crypto?.subtle) {
        const bytes = new TextEncoder().encode(value);
        const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
        return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    // ponytail: legacy browsers retain deterministic retries; modern browsers take the SHA-256 path.
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
    return Math.abs(hash).toString(16);
}

function normalizePortfolioUrl(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return "";
    try {
        const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
        return /^https?:$/.test(parsed.protocol) ? parsed.toString() : null;
    } catch {
        return null;
    }
}

/** One visual recruitment surface; invitation and application server commands remain deliberately separate. */
export default function InviteCollaboratorModal({
    isOpen,
    onClose,
    onSuccess,
    mode = "invite",
    projectId,
    projectTitle,
    roles,
    projects,
    preselectedRoleId,
    candidate: initialCandidate,
    canAppointGuidance = false,
}: InviteCollaboratorModalProps) {
    const { user } = useAuth();
    const [loadingOptions, setLoadingOptions] = useState(false);
    const [searching, setSearching] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [selectedProjectId, setSelectedProjectId] = useState(projectId || "");
    const [projectRoles, setProjectRoles] = useState<ParticipationRole[]>(roles || []);
    const [people, setPeople] = useState<Candidate[]>([]);
    const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(initialCandidate || null);
    const [searchQuery, setSearchQuery] = useState("");
    const [roleId, setRoleId] = useState(preselectedRoleId || "");
    const [inviteKind, setInviteKind] = useState<InvitationKind>("ordinary_role");
    const [guidanceLabel, setGuidanceLabel] = useState("Guide");
    const [reviewAt, setReviewAt] = useState("");
    const [note, setNote] = useState("");
    const [applicationMessage, setApplicationMessage] = useState("");
    const [portfolioUrl, setPortfolioUrl] = useState("");
    const [availability, setAvailability] = useState("");
    const [alignment, setAlignment] = useState<AttributeAlignment | null>(null);
    const [guidancePreflight, setGuidancePreflight] = useState<GuidancePreflight | null>(null);
    const [guidanceLoading, setGuidanceLoading] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [applicationDraftLoaded, setApplicationDraftLoaded] = useState(false);
    const [optionsVersion, setOptionsVersion] = useState(0);
    const [isChoosingProject, setIsChoosingProject] = useState(false);

    const optionsCache = useRef(new Map<string, CachedOptions>());
    const searchCache = useRef(new Map<string, Candidate[]>());
    const guidancePreflightCache = useRef(new Map<string, GuidancePreflight>());
    const searchSequence = useRef(0);
    const guidanceSequence = useRef(0);
    const openedAt = useRef(0);
    const projectPickerRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const roleSelectRef = useRef<HTMLSelectElement>(null);
    const guidanceLabelRef = useRef<HTMLInputElement>(null);
    const applicationMessageRef = useRef<HTMLTextAreaElement>(null);

    const projectOptions = useMemo<ParticipationProject[]>(() => {
        if (projectId && projectTitle) {
            return [{ id: projectId, title: projectTitle, role: canAppointGuidance ? "owner" : "admin", openRoles: roles }];
        }
        return projects || [];
    }, [canAppointGuidance, projectId, projectTitle, projects, roles]);
    const selectedProject = projectOptions.find((project) => project.id === selectedProjectId) || null;
    const activeRoles = mode === "apply" && selectedProject?.openRoles ? selectedProject.openRoles : projectRoles;
    const selectableRoles = useMemo(() => activeRoles.filter((role) => remainingRoles(role) > 0), [activeRoles]);
    const selectableRoleKey = useMemo(() => selectableRoles.map((role) => role.id).join("|"), [selectableRoles]);
    const selectedRole = activeRoles.find((role) => role.id === roleId) || null;
    const candidateIsFixed = Boolean(initialCandidate);
    const projectIsFixed = Boolean(projectId);
    const canAppointSelectedGuidance = mode === "invite" && (canAppointGuidance || selectedProject?.role === "owner");
    const hasPendingApplication = selectedCandidate?.state === "application_pending";
    const hasPendingInvitation = selectedCandidate?.state === "invitation_pending";
    const applicationDraftKey = `recruitment-application-draft:v2:${user?.id || "anonymous"}:${selectedProjectId || "select"}`;
    const guidanceUnavailable = Boolean(guidancePreflight?.activeGuide || guidancePreflight?.capacity === "blocked");
    const showProjectPicker = !projectIsFixed && (!selectedProject || isChoosingProject);

    const showError = (message: string, focus?: React.RefObject<HTMLElement | null>) => {
        setFormError(message);
        toast.error(message);
        window.requestAnimationFrame(() => focus?.current?.focus());
    };

    const refreshProjectOptions = (affectedProjectId: string) => {
        optionsCache.current.delete(affectedProjectId);
        for (const key of searchCache.current.keys()) {
            if (key.startsWith(`${affectedProjectId}:`)) searchCache.current.delete(key);
        }
        setOptionsVersion((version) => version + 1);
    };

    const closeComposer = (reason: "cancelled" | "dismissed" | "completed") => {
        logger.metric("recruitment.composer.closed", {
            module: "recruitment-composer",
            kind: mode,
            reason,
            durationMs: openedAt.current ? Math.round(performance.now() - openedAt.current) : 0,
        });
        onClose();
    };

    useEffect(() => {
        if (isOpen) {
            openedAt.current = performance.now();
            setSelectedProjectId(projectId || projects?.[0]?.id || "");
            setSelectedCandidate(initialCandidate || null);
            setSearchQuery("");
            setRoleId(preselectedRoleId || "");
            setInviteKind("ordinary_role");
            setGuidanceLabel("Guide");
            setReviewAt("");
            setNote("");
            setApplicationMessage("");
            setPortfolioUrl("");
            setAvailability("");
            setAlignment(null);
            setGuidancePreflight(null);
            setFormError(null);
            setApplicationDraftLoaded(mode !== "apply");
            setIsChoosingProject(false);
            logger.metric("recruitment.composer.opened", { module: "recruitment-composer", kind: mode, route: projectIsFixed ? "project" : "profile" });
        } else {
            optionsCache.current.clear();
            searchCache.current.clear();
            guidancePreflightCache.current.clear();
            searchSequence.current += 1;
            guidanceSequence.current += 1;
        }
    }, [initialCandidate, isOpen, mode, preselectedRoleId, projectId, projectIsFixed, projects]);

    useEffect(() => {
        if (isChoosingProject) window.requestAnimationFrame(() => projectPickerRef.current?.focus());
    }, [isChoosingProject]);

    useEffect(() => {
        if (!isOpen || !selectedProjectId) return;
        if (mode === "apply" && selectedProject?.openRoles) {
            setProjectRoles(selectedProject.openRoles);
            return;
        }
        if (projectIsFixed && roles) {
            setProjectRoles(roles);
            return;
        }
        const cached = optionsCache.current.get(selectedProjectId);
        if (cached) {
            setProjectRoles(cached.roles);
            if (mode === "invite" && !candidateIsFixed) setPeople(cached.people);
            return;
        }
        let cancelled = false;
        setLoadingOptions(true);
        const startedAt = performance.now();
        void getProjectInviteOptionsAction(selectedProjectId).then((result) => {
            if (cancelled) return;
            if (!result.success) {
                logger.metric("recruitment.composer.options", { module: "recruitment-composer", projectId: selectedProjectId, kind: mode, outcome: "failure", durationMs: Math.round(performance.now() - startedAt) });
                showError(result.error || "Failed to load project options", projectPickerRef);
                setProjectRoles([]);
                return;
            }
            const initialPeople: Candidate[] = (result.connections || []).map((person) => ({
                id: person.id,
                username: person.username,
                fullName: person.fullName,
                avatarUrl: person.avatarUrl,
                headline: person.headline,
                state: person.pendingApplicationId ? "application_pending" : person.pendingInvitations.length ? "invitation_pending" : "eligible",
            }));
            const cachedOptions = { roles: result.openRoles || [], people: initialPeople };
            optionsCache.current.set(selectedProjectId, cachedOptions);
            setProjectRoles(cachedOptions.roles);
            if (mode === "invite" && !candidateIsFixed) setPeople(initialPeople);
            logger.metric("recruitment.composer.options", { module: "recruitment-composer", projectId: selectedProjectId, kind: mode, outcome: "success", durationMs: Math.round(performance.now() - startedAt) });
        }).catch(() => {
            if (!cancelled) {
                logger.metric("recruitment.composer.options", { module: "recruitment-composer", projectId: selectedProjectId, kind: mode, outcome: "failure", durationMs: Math.round(performance.now() - startedAt) });
                showError("Failed to load project options", projectPickerRef);
            }
        }).finally(() => {
            if (!cancelled) setLoadingOptions(false);
        });
        return () => { cancelled = true; };
    }, [candidateIsFixed, isOpen, mode, optionsVersion, projectIsFixed, roles, selectedProject?.openRoles, selectedProjectId]);

    useEffect(() => {
        if (!isOpen || mode !== "invite" || candidateIsFixed || !selectedProjectId || selectedCandidate) return;
        const query = searchQuery.trim();
        if (query.length < 2) {
            setSearching(false);
            if (!query) setPeople(optionsCache.current.get(selectedProjectId)?.people || []);
            return;
        }
        const cacheKey = `${selectedProjectId}:${query.toLowerCase()}`;
        const cached = searchCache.current.get(cacheKey);
        if (cached) {
            setPeople(cached);
            return;
        }
        const request = ++searchSequence.current;
        const startedAt = performance.now();
        const timer = window.setTimeout(() => {
            setSearching(true);
            void searchProjectInviteCandidatesAction({ projectId: selectedProjectId, query }).then((result) => {
                if (request !== searchSequence.current) return;
                if (!result.success) {
                    logger.metric("recruitment.composer.search", { module: "recruitment-composer", projectId: selectedProjectId, queryLengthBucket: queryBucket(query), durationMs: Math.round(performance.now() - startedAt), outcome: "failure" });
                    showError(result.error || "Unable to search people", searchInputRef);
                    return;
                }
                const items = result.items.map((person) => ({ ...person, state: person.state as Candidate["state"] }));
                searchCache.current.set(cacheKey, items);
                setPeople(items);
                logger.metric("recruitment.composer.search", {
                    module: "recruitment-composer",
                    projectId: selectedProjectId,
                    queryLengthBucket: queryBucket(query),
                    resultCount: items.length,
                    durationMs: Math.round(performance.now() - startedAt),
                    outcome: "success",
                });
            }).catch(() => {
                if (request === searchSequence.current) {
                    logger.metric("recruitment.composer.search", { module: "recruitment-composer", projectId: selectedProjectId, queryLengthBucket: queryBucket(query), durationMs: Math.round(performance.now() - startedAt), outcome: "failure" });
                    showError("Unable to search people", searchInputRef);
                }
            }).finally(() => {
                if (request === searchSequence.current) setSearching(false);
            });
        }, 280);
        return () => window.clearTimeout(timer);
    }, [candidateIsFixed, isOpen, mode, searchQuery, selectedCandidate, selectedProjectId]);

    useEffect(() => {
        const defaultRole = preselectedRoleId && selectableRoles.some((role) => role.id === preselectedRoleId)
            ? preselectedRoleId
            : selectableRoles[0]?.id || "";
        setRoleId((current) => selectableRoles.some((role) => role.id === current) ? current : defaultRole);
    }, [preselectedRoleId, selectableRoleKey, selectedProjectId]);

    useEffect(() => {
        if (!isOpen || mode !== "apply" || !selectedProjectId || !user?.id) return;
        let cancelled = false;
        setApplicationDraftLoaded(false);
        void get(applicationDraftKey).then(async (raw) => {
            if (cancelled || !raw || typeof raw !== "object") return;
            const draft = raw as { version?: number; savedAt?: number; roleId?: string; message?: string; portfolioUrl?: string; availability?: string };
            if (draft.version && draft.version !== 1) {
                await del(applicationDraftKey);
                return;
            }
            if (!draft.savedAt || Date.now() - draft.savedAt > APPLICATION_DRAFT_TTL_MS) {
                await del(applicationDraftKey);
                return;
            }
            if (draft.roleId && selectableRoles.some((role) => role.id === draft.roleId)) setRoleId(draft.roleId);
            setApplicationMessage((draft.message || "").slice(0, APPLICATION_LIMIT));
            setPortfolioUrl(draft.portfolioUrl || "");
            setAvailability(draft.availability || "");
        }).catch(() => undefined).finally(() => {
            if (!cancelled) setApplicationDraftLoaded(true);
        });
        return () => { cancelled = true; };
    }, [applicationDraftKey, isOpen, mode, selectableRoleKey, selectedProjectId, user?.id]);

    useEffect(() => {
        if (!isOpen || mode !== "apply" || !selectedProjectId || !user?.id || !applicationDraftLoaded) return;
        const timer = window.setTimeout(() => {
            const hasDraft = applicationMessage.trim() || portfolioUrl.trim() || availability.trim();
            void (hasDraft
                ? set(applicationDraftKey, { version: 1, roleId, message: applicationMessage, portfolioUrl, availability, savedAt: Date.now() })
                : del(applicationDraftKey)
            );
        }, 750);
        return () => window.clearTimeout(timer);
    }, [applicationDraftKey, applicationDraftLoaded, applicationMessage, availability, isOpen, mode, portfolioUrl, roleId, selectedProjectId, user?.id]);

    useEffect(() => {
        if (!selectedCandidate || !selectedProject || mode !== "invite" || inviteKind === "guidance_appointment") return;
        const role = activeRoles.find((item) => item.id === roleId);
        setNote(`Hey ${displayName(selectedCandidate)}, I think you'd be a great fit for the ${role ? roleLabel(role) : "collaborator"} role on ${selectedProject.title}. Let's build this together!`);
    }, [activeRoles, inviteKind, mode, roleId, selectedCandidate, selectedProject]);

    useEffect(() => {
        if (mode !== "invite" || inviteKind !== "ordinary_role" || !selectedCandidate || !roleId) {
            setAlignment(null);
            return;
        }
        let cancelled = false;
        void getProfileToRoleAlignmentAction(selectedCandidate.id, roleId).then((result) => {
            if (!cancelled) setAlignment(result);
        }).catch(() => {
            if (!cancelled) setAlignment(null);
        });
        return () => { cancelled = true; };
    }, [inviteKind, mode, roleId, selectedCandidate]);

    useEffect(() => {
        if (mode !== "invite" || inviteKind !== "guidance_appointment" || !selectedCandidate || !selectedProject || !canAppointSelectedGuidance) {
            setGuidancePreflight(null);
            return;
        }
        const cacheKey = `${selectedProject.id}:${selectedCandidate.id}`;
        const cached = guidancePreflightCache.current.get(cacheKey);
        if (cached) {
            setGuidancePreflight(cached);
            setGuidanceLoading(false);
            return;
        }
        const request = ++guidanceSequence.current;
        const startedAt = performance.now();
        let cancelled = false;
        setGuidanceLoading(true);
        void getProjectGuidancePreflightAction({ projectId: selectedProject.id, candidateId: selectedCandidate.id }).then((result) => {
            if (cancelled || request !== guidanceSequence.current) return;
            if (!result.success) {
                logger.metric("recruitment.composer.guidance_preflight", { module: "recruitment-composer", projectId: selectedProject.id, outcome: "failure", durationMs: Math.round(performance.now() - startedAt) });
                setGuidancePreflight(null);
                showError(result.error || "Unable to verify the Guide appointment");
                return;
            }
            const preflight = { activeGuide: result.activeGuide, capacity: result.capacity };
            guidancePreflightCache.current.set(cacheKey, preflight);
            setGuidancePreflight(preflight);
            logger.metric("recruitment.composer.guidance_preflight", { module: "recruitment-composer", projectId: selectedProject.id, outcome: "success", durationMs: Math.round(performance.now() - startedAt) });
        }).catch(() => {
            if (!cancelled && request === guidanceSequence.current) {
                logger.metric("recruitment.composer.guidance_preflight", { module: "recruitment-composer", projectId: selectedProject.id, outcome: "failure", durationMs: Math.round(performance.now() - startedAt) });
                showError("Unable to verify the Guide appointment");
            }
        }).finally(() => {
            if (!cancelled && request === guidanceSequence.current) setGuidanceLoading(false);
        });
        return () => { cancelled = true; guidanceSequence.current += 1; };
    }, [canAppointSelectedGuidance, inviteKind, mode, selectedCandidate, selectedProject]);

    const selectCandidate = (candidate: Candidate) => {
        setSelectedCandidate(candidate);
        setFormError(null);
        logger.metric("recruitment.composer.candidate_selected", { module: "recruitment-composer", projectId: selectedProjectId, kind: mode });
        window.requestAnimationFrame(() => roleSelectRef.current?.focus());
    };

    const submit = async () => {
        if (!selectedProject) return showError("Select a project first", projectPickerRef);
        if (mode === "invite" && !selectedCandidate) return showError("Select a person to invite", searchInputRef);
        if ((mode === "apply" || inviteKind === "ordinary_role") && !roleId) return showError("Select an available role", roleSelectRef);
        if (mode === "invite" && hasPendingApplication) return showError("Review the existing application before sending an invitation");
        if (mode === "invite" && hasPendingInvitation) return showError("An invitation is already pending for this person");
        if (mode === "invite" && inviteKind === "guidance_appointment" && !guidanceLabel.trim()) return showError("Enter a guidance label", guidanceLabelRef);
        if (mode === "invite" && inviteKind === "guidance_appointment" && guidanceUnavailable) return showError(guidancePreflight?.activeGuide ? "This project already has an active Guide" : "This person has reached the active Guide limit");
        if (mode === "apply" && !applicationMessage.trim()) return showError("Add a short application message", applicationMessageRef);

        const startedAt = performance.now();
        setSubmitting(true);
        setFormError(null);
        try {
            if (mode === "apply") {
                const safePortfolioUrl = normalizePortfolioUrl(portfolioUrl);
                if (safePortfolioUrl === null) return showError("Enter a valid portfolio or GitHub URL");
                const details = [
                    applicationMessage.trim(),
                    safePortfolioUrl ? `Portfolio / GitHub: ${safePortfolioUrl}` : "",
                    availability.trim() ? `Availability: ${availability.trim()}` : "",
                ].filter(Boolean).join("\n\n");
                if (details.length > 2000) return showError("Application text is too long. Please shorten it.", applicationMessageRef);
                const idempotencyKey = `apply:${await fingerprint(`${selectedProject.id}:${roleId}:${details}`)}`;
                const result = await applyToRoleAction(selectedProject.id, roleId, details, { idempotencyKey, applyingProjectId: null, applyingProjectRole: null });
                if (!result.success) {
                    logger.metric("recruitment.composer.submit", { module: "recruitment-composer", projectId: selectedProject.id, kind: mode, outcome: "failure", errorCode: result.errorCode || "APPLICATION_FAILED", durationMs: Math.round(performance.now() - startedAt) });
                    return showError(result.error || "Failed to submit application", applicationMessageRef);
                }
                if (user?.id) await del(applicationDraftKey);
                toast.success(result.idempotent ? "Your existing application is already pending" : "Application submitted successfully");
            } else {
                const payload = `${selectedProject.id}:${selectedCandidate!.id}:${inviteKind}:${roleId}:${guidanceLabel.trim()}:${reviewAt}:${note.trim()}`;
                const result = await createProjectInvitationAction({
                    projectId: selectedProject.id,
                    candidateId: selectedCandidate!.id,
                    kind: inviteKind,
                    roleId: inviteKind === "ordinary_role" ? roleId : null,
                    note: note.trim() || null,
                    guidanceLabel: inviteKind === "guidance_appointment" ? guidanceLabel : null,
                    reviewAt: inviteKind === "guidance_appointment" ? reviewAt || null : null,
                    idempotencyKey: `invite:${await fingerprint(payload)}`,
                });
                if (!result.success) {
                    logger.metric("recruitment.composer.submit", { module: "recruitment-composer", projectId: selectedProject.id, kind: mode, outcome: "failure", errorCode: "INVITATION_FAILED", durationMs: Math.round(performance.now() - startedAt) });
                    if (/role is no longer available|guidance appointment/i.test(result.error || "")) refreshProjectOptions(selectedProject.id);
                    return showError(result.error || "Failed to send invitation");
                }
                toast.success(result.capacityWarning ? "Invitation sent. This person is nearing their Guide capacity." : "Invitation sent successfully");
            }
            logger.metric("recruitment.composer.submit", { module: "recruitment-composer", projectId: selectedProject.id, kind: mode, outcome: "success", durationMs: Math.round(performance.now() - startedAt) });
            onSuccess?.();
            closeComposer("completed");
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to complete this action";
            logger.metric("recruitment.composer.submit", { module: "recruitment-composer", projectId: selectedProject.id, kind: mode, outcome: "failure", durationMs: Math.round(performance.now() - startedAt) });
            showError(message);
        } finally {
            setSubmitting(false);
        }
    };

    const step = (label: string) => <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</p>;
    const selectedProjectContext = selectedProject ? <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"><span><span className="text-zinc-500">Project:</span> <strong>{selectedProject.title}</strong></span>{!projectIsFixed ? <Button type="button" variant="ghost" size="sm" aria-expanded={isChoosingProject} aria-controls="recruitment-project-list" onClick={() => setIsChoosingProject((open) => !open)}>{isChoosingProject ? "Cancel" : "Change"}</Button> : null}</div> : null;
    // ponytail: an anchored list keeps the application form and modal dimensions intact.
    const projectPicker = showProjectPicker ? <div ref={projectPickerRef} tabIndex={-1} className="absolute inset-x-0 top-full z-10 mt-2 animate-in fade-in slide-in-from-top-1 duration-150 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg outline-none dark:border-zinc-800 dark:bg-zinc-950">{step("Select project")}<div id="recruitment-project-list" role="listbox" aria-label="Available projects" className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800">{projectOptions.length ? projectOptions.map((project) => <button key={project.id} type="button" role="option" aria-selected={project.id === selectedProjectId} onClick={() => { setSelectedProjectId(project.id); setIsChoosingProject(false); setFormError(null); }} className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors ${project.id === selectedProjectId ? "bg-primary/10 font-semibold text-primary" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"}`}><span className="truncate">{project.title}</span>{project.id === selectedProjectId ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}</button>) : <p className="px-3 py-2.5 text-sm text-zinc-500">No eligible projects available.</p>}</div></div> : null;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && !submitting && closeComposer("dismissed")}>
            <DialogContent className="sm:max-w-[550px] gap-0 overflow-hidden rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
                <DialogHeader className="border-b border-zinc-100 px-5 py-3.5 text-left dark:border-zinc-900">
                    <DialogTitle className="flex items-center gap-2 text-xl font-bold tracking-tight">
                        {mode === "apply" ? <Briefcase aria-hidden="true" className="size-5 text-primary" /> : <Users aria-hidden="true" className="size-5 text-primary" />}
                        {mode === "apply" ? "Apply to Join" : "Invite Collaborator"}
                    </DialogTitle>
                </DialogHeader>

                <div className="max-h-[65vh] space-y-4 overflow-y-auto px-5 py-4">
                    {formError ? <div role="alert" className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{formError}</div> : null}

                    <div className="relative">
                        {selectedProjectContext}
                        {projectPicker}
                    </div>

                    {mode === "invite" && !candidateIsFixed && selectedProjectId ? <div className="space-y-2">{step("Select person")}<label className="sr-only" htmlFor="recruitment-person-search">Search people</label>{!selectedCandidate ? <><div className="relative"><Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" /><input ref={searchInputRef} id="recruitment-person-search" value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); setFormError(null); }} placeholder="Search connections or people..." className="w-full rounded-xl border border-zinc-200 bg-zinc-50 py-2 pl-9 pr-3 text-sm dark:border-zinc-800 dark:bg-zinc-900" /></div><div role="status" aria-live="polite" className="sr-only">{searching ? "Searching people." : `${people.length} eligible ${people.length === 1 ? "person" : "people"} found.`}</div><div aria-busy={loadingOptions || searching} className="h-[230px] overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-900">{loadingOptions || searching ? <div className="flex h-full items-center justify-center"><Loader2 aria-label="Loading people" className="size-5 animate-spin text-primary" /></div> : people.length === 0 ? <div className="flex h-full items-center justify-center px-4 text-center text-sm text-zinc-500">{searchQuery.trim().length === 1 ? "Type at least two characters to search people." : "No eligible people found."}</div> : <Virtuoso style={{ height: 230 }} data={people} itemContent={(_, candidate) => <button type="button" onClick={() => selectCandidate(candidate)} aria-label={`Select ${displayName(candidate)}`} className="flex w-full items-center gap-3 border-b border-zinc-100 px-3 py-2.5 text-left hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900"><Avatar className="size-9"><AvatarImage src={candidate.avatarUrl || undefined} /><AvatarFallback>{displayName(candidate)[0]}</AvatarFallback></Avatar><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{displayName(candidate)} {candidate.username && candidate.fullName ? <span className="font-normal text-zinc-500">@{candidate.username}</span> : null}</span><span className="block truncate text-xs text-zinc-500">{candidate.headline || ""}</span></span>{candidate.state === "application_pending" ? <span className="text-[10px] font-semibold text-amber-600">APPLIED</span> : null}{candidate.state === "invitation_pending" ? <span className="text-[10px] font-semibold text-amber-600">INVITED</span> : null}</button>} />}</div></> : <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900"><span className="text-sm font-semibold">Candidate: {displayName(selectedCandidate)}</span><Button type="button" size="sm" variant="ghost" onClick={() => { setSelectedCandidate(null); setFormError(null); window.requestAnimationFrame(() => searchInputRef.current?.focus()); }}>Change</Button></div>}</div> : null}

                    {(mode === "apply" || selectedCandidate) && selectedProjectId ? <>
                        {mode === "invite" ? <div className="space-y-2">{step("Invite as")}<label className="sr-only" htmlFor="recruitment-invite-kind">Invitation type</label><select id="recruitment-invite-kind" value={inviteKind} onChange={(event) => { setInviteKind(event.target.value as InvitationKind); setFormError(null); }} className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"><option value="ordinary_role">Open role</option>{canAppointSelectedGuidance ? <option value="guidance_appointment">Invite as Guide</option> : null}</select></div> : null}

                        {mode === "invite" && inviteKind === "guidance_appointment" ? <div className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><label htmlFor="recruitment-guidance-label" className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Guidance label</label><input ref={guidanceLabelRef} id="recruitment-guidance-label" value={guidanceLabel} onChange={(event) => setGuidanceLabel(event.target.value.slice(0, 60))} maxLength={60} className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900" /></div><div className="space-y-2"><label htmlFor="recruitment-review-date" className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Review date <span className="normal-case font-normal">(optional)</span></label><input id="recruitment-review-date" type="date" value={reviewAt} onChange={(event) => setReviewAt(event.target.value)} className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900" /></div></div>{guidanceLoading ? <p className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="size-3.5 animate-spin" />Checking Guide availability…</p> : guidancePreflight?.activeGuide ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{guidancePreflight.activeGuide.label}: {guidancePreflight.activeGuide.name} is already active on this project.</div> : guidancePreflight?.capacity === "blocked" ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">This person has reached the active Guide appointment limit.</div> : guidancePreflight?.capacity === "warning" ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">This person is nearing their active Guide appointment capacity.</div> : <p className="text-xs text-zinc-500">On acceptance, this appointment uses the project’s existing Co-leader access.</p>}</div> : <div className="space-y-2">{step(mode === "apply" ? "Select role" : "Assign role")}<label className="sr-only" htmlFor="recruitment-role">Role</label><select ref={roleSelectRef} id="recruitment-role" value={roleId} onChange={(event) => { setRoleId(event.target.value); setFormError(null); }} disabled={selectableRoles.length === 0} className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900"><option value="">{selectableRoles.length ? "Select a role" : "No open roles available"}</option>{selectableRoles.map((role) => <option key={role.id} value={role.id}>{roleLabel(role)} ({remainingRoles(role)} spot{remainingRoles(role) === 1 ? "" : "s"} left)</option>)}</select>{selectedRole?.description ? <p className="text-xs text-zinc-500">{selectedRole.description}</p> : null}{selectedRole?.skills?.length ? <p className="text-xs text-zinc-500">Skills: {selectedRole.skills.slice(0, 6).join(", ")}</p> : null}</div>}

                        {mode === "invite" && hasPendingApplication ? <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Review this person’s existing application instead of sending a separate invitation.</div> : null}{mode === "invite" && hasPendingInvitation ? <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />An invitation is already pending for this person.</div> : null}
                        {mode === "invite" && alignment && inviteKind === "ordinary_role" ? <div className="grid grid-cols-3 gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900"><span className="flex items-center gap-1">{alignment.commitmentMatch.aligns ? <Check aria-hidden="true" className="size-3 text-emerald-600" /> : null}Commitment</span><span className="flex items-center gap-1">{alignment.capacityMatch.aligns ? <Check aria-hidden="true" className="size-3 text-emerald-600" /> : null}Capacity</span><span className="flex items-center gap-1">{alignment.experienceMatch.aligns ? <Check aria-hidden="true" className="size-3 text-emerald-600" /> : null}Experience</span></div> : null}

                        {mode === "invite" ? <div className="space-y-2">{step("Invitation note")}<label className="sr-only" htmlFor="recruitment-note">Invitation note</label><textarea id="recruitment-note" value={note} onChange={(event) => setNote(event.target.value.slice(0, NOTE_LIMIT))} rows={4} maxLength={NOTE_LIMIT} placeholder="Add a friendly note..." className="w-full resize-none rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900" /><p className="text-right text-xs text-zinc-500">{note.length}/{NOTE_LIMIT}</p></div> : <div className="space-y-4"><div className="space-y-2"><label htmlFor="recruitment-application-message" className="text-sm font-semibold">Why are you a fit?</label><textarea ref={applicationMessageRef} id="recruitment-application-message" value={applicationMessage} onChange={(event) => setApplicationMessage(event.target.value.slice(0, APPLICATION_LIMIT))} rows={5} maxLength={APPLICATION_LIMIT} placeholder="Describe your relevant skills, execution style, and first-week contribution." className="w-full resize-none rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900" /><div className="flex justify-between text-xs text-zinc-500"><span>{applicationMessage.trim().split(/\s+/).filter(Boolean).length < 12 ? "Add a concise intro, relevant skills, and expected contribution." : "Good application detail."}</span><span>{applicationMessage.length}/{APPLICATION_LIMIT}</span></div></div><div><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-zinc-500"><Sparkles aria-hidden="true" className="size-3.5" />Quick prompts</div><div className="flex flex-wrap gap-2">{APPLICATION_PROMPTS.map((prompt) => <button type="button" key={prompt} onClick={() => setApplicationMessage((value) => value.includes(prompt) ? value : `${value.trim()}${value.trim() ? "\n\n" : ""}${prompt}`.slice(0, APPLICATION_LIMIT))} className="rounded-full border border-zinc-200 px-2.5 py-1 text-[11px] text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900">{prompt.length > 42 ? `${prompt.slice(0, 42)}…` : prompt}</button>)}</div></div><div className="grid gap-3 sm:grid-cols-2"><div><label htmlFor="recruitment-portfolio" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Portfolio / GitHub <span className="font-normal">(optional)</span></label><input id="recruitment-portfolio" value={portfolioUrl} onChange={(event) => setPortfolioUrl(event.target.value)} placeholder="https://…" className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900" /></div><div><label htmlFor="recruitment-availability" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Availability <span className="font-normal">(optional)</span></label><input id="recruitment-availability" value={availability} onChange={(event) => setAvailability(event.target.value)} placeholder="e.g. 15 hrs/week" className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900" /></div></div><p className="text-xs text-zinc-500">Your application is sent to the project owner/admin team and mirrored in the existing conversation when available.</p></div>}
                    </> : null}
                </div>

                <DialogFooter className="border-t border-zinc-100 bg-zinc-50 px-5 py-3 dark:border-zinc-900 dark:bg-zinc-950"><Button type="button" variant="outline" onClick={() => closeComposer("cancelled")} disabled={submitting}>Cancel</Button><Button type="button" onClick={submit} disabled={submitting || !selectedProject || (mode === "apply" ? !roleId || !applicationMessage.trim() : !selectedCandidate || hasPendingApplication || hasPendingInvitation || (inviteKind === "ordinary_role" && !roleId) || (inviteKind === "guidance_appointment" && (!guidanceLabel.trim() || guidanceLoading || guidanceUnavailable)))}>{submitting ? <Loader2 aria-label="Submitting" className="size-4 animate-spin" /> : null}{submitting ? "Sending..." : mode === "apply" ? "Submit Application" : "Send Invitation"}</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
