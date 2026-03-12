"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { EditProfileTabs } from "./EditProfileTabs";
import Button from "@/components/ui-custom/Button";
import { updateProfileAction } from "@/app/actions/profile";
import { useToast } from "@/components/ui-custom/Toast";
import { useAuth } from "@/lib/hooks/use-auth";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { calculateProfileCompletion } from "@/lib/validations/profile";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/query-keys";

interface EditProfileModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    profile: any;
    // Optimistic update callback
    onOptimisticUpdate?: (updates: any) => void;
}

type EditSection = "general" | "experience" | "education" | "skills" | "social";
type SaveState = "idle" | "saving" | "success" | "error";

const DRAFT_KEY_PREFIX = "profile:edit:draft:v1:";

function toIsoTimestamp(value: unknown): string {
    if (typeof value === "string" && value.trim()) return value;
    if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
    return new Date().toISOString();
}

function toFormState(profile: any) {
    const source = profile || {};
    return {
        full_name: source.fullName || source.full_name || "",
        username: source.username || "",
        headline: source.headline || "",
        bio: source.bio || "",
        location: source.location || "",
        website: source.website || "",
        avatar_url: source.avatarUrl || source.avatar_url || "",
        banner_url: source.bannerUrl || source.banner_url || "",
        availabilityStatus: source.availabilityStatus || source.availability_status || "available",
        openTo: source.openTo || source.open_to || [],
        skills: source.skills || [],
        socialLinks: source.socialLinks || source.social_links || {},
        experience: source.experience || [],
        education: source.education || [],
    };
}

function sectionKeys(section: EditSection): string[] {
    switch (section) {
        case "general":
            return ["full_name", "username", "headline", "bio", "location", "website", "avatar_url", "banner_url", "availabilityStatus", "openTo"];
        case "experience":
            return ["experience"];
        case "education":
            return ["education"];
        case "skills":
            return ["skills"];
        case "social":
            return ["socialLinks"];
    }
}

function buildActionPayload(formState: any, expectedUpdatedAt?: string) {
    const normalizedExpectedUpdatedAt = (() => {
        if (!expectedUpdatedAt || typeof expectedUpdatedAt !== "string") return undefined;
        const parsed = new Date(expectedUpdatedAt);
        if (!Number.isFinite(parsed.getTime())) return undefined;
        return parsed.toISOString();
    })();

    return {
        fullName: formState.full_name,
        username: formState.username,
        headline: formState.headline,
        bio: formState.bio,
        location: formState.location,
        website: formState.website,
        avatarUrl: formState.avatar_url,
        bannerUrl: formState.banner_url,
        skills: formState.skills,
        socialLinks: formState.socialLinks,
        availabilityStatus: formState.availabilityStatus,
        openTo: formState.openTo,
        experience: formState.experience,
        education: formState.education,
        ...(normalizedExpectedUpdatedAt ? { expectedUpdatedAt: normalizedExpectedUpdatedAt } : {}),
    };
}

function buildPartialPayload(formState: any, section: EditSection, expectedUpdatedAt?: string) {
    const keys = sectionKeys(section);
    const payload = buildActionPayload(formState, expectedUpdatedAt) as Record<string, unknown>;
    const partial: Record<string, unknown> = {};
    if (typeof payload.expectedUpdatedAt === "string") {
        partial.expectedUpdatedAt = payload.expectedUpdatedAt;
    }
    for (const key of keys) {
        if (key === "full_name") partial.fullName = payload.fullName;
        if (key === "username") partial.username = payload.username;
        if (key === "headline") partial.headline = payload.headline;
        if (key === "bio") partial.bio = payload.bio;
        if (key === "location") partial.location = payload.location;
        if (key === "website") partial.website = payload.website;
        if (key === "avatar_url") partial.avatarUrl = payload.avatarUrl;
        if (key === "banner_url") partial.bannerUrl = payload.bannerUrl;
        if (key === "availabilityStatus") partial.availabilityStatus = payload.availabilityStatus;
        if (key === "openTo") partial.openTo = payload.openTo;
        if (key === "skills") partial.skills = payload.skills;
        if (key === "socialLinks") partial.socialLinks = payload.socialLinks;
        if (key === "experience") partial.experience = payload.experience;
        if (key === "education") partial.education = payload.education;
    }
    return partial;
}

function applyPayloadToBaseState(base: any, payload: Record<string, unknown>) {
    const next = { ...base }
    if (payload.fullName !== undefined) next.full_name = payload.fullName
    if (payload.username !== undefined) next.username = payload.username
    if (payload.headline !== undefined) next.headline = payload.headline
    if (payload.bio !== undefined) next.bio = payload.bio
    if (payload.location !== undefined) next.location = payload.location
    if (payload.website !== undefined) next.website = payload.website
    if (payload.avatarUrl !== undefined) next.avatar_url = payload.avatarUrl
    if (payload.bannerUrl !== undefined) next.banner_url = payload.bannerUrl
    if (payload.availabilityStatus !== undefined) next.availabilityStatus = payload.availabilityStatus
    if (payload.openTo !== undefined) next.openTo = payload.openTo
    if (payload.skills !== undefined) next.skills = payload.skills
    if (payload.socialLinks !== undefined) next.socialLinks = payload.socialLinks
    if (payload.experience !== undefined) next.experience = payload.experience
    if (payload.education !== undefined) next.education = payload.education
    return next
}

function hasFormChanges(next: Record<string, unknown>, base: Record<string, unknown>): boolean {
    for (const key of Object.keys(base)) {
        if (JSON.stringify(next[key]) !== JSON.stringify(base[key])) {
            return true;
        }
    }
    return false;
}

export function EditProfileModal({ open, onOpenChange, profile, onOptimisticUpdate }: EditProfileModalProps) {
    const { showToast } = useToast();
    const queryClient = useQueryClient();
    const { refreshProfile } = useAuth();
    const [formState, setFormState] = useState<any>(null);
    const [saveState, setSaveState] = useState<SaveState>("idle");
    const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
    const [hasChanges, setHasChanges] = useState(false);
    const inFlightRef = useRef(false);
    const wasOpenRef = useRef(false);
    const lastKnownUpdatedAtRef = useRef<string>(
        toIsoTimestamp(profile?.updatedAt || profile?.updated_at)
    );
    const baseProfileRef = useRef<any>(toFormState(profile));

    const completion = useMemo(
        () =>
            calculateProfileCompletion({
                avatarUrl: formState?.avatar_url || "",
                fullName: formState?.full_name || "",
                username: formState?.username || "",
                headline: formState?.headline || "",
                bio: formState?.bio || "",
                location: formState?.location || "",
                website: formState?.website || "",
                skills: formState?.skills || [],
                socialLinks: formState?.socialLinks || {},
            }),
        [formState]
    );

    useEffect(() => {
        if (!profile?.id) {
            if (!open) {
                setFormState(null);
                setHasChanges(false);
            }
            return;
        }
        const isOpening = open && !wasOpenRef.current;
        wasOpenRef.current = open;
        if (isOpening) {
            const normalized = toFormState(profile);
            baseProfileRef.current = normalized;
            const draftKey = `${DRAFT_KEY_PREFIX}${profile.id}`;
            if (typeof window !== "undefined") {
                const raw = window.localStorage.getItem(draftKey);
                if (raw) {
                    try {
                        const parsed = JSON.parse(raw);
                        setFormState({ ...normalized, ...parsed });
                    } catch {
                        setFormState(normalized);
                    }
                } else {
                    setFormState(normalized);
                }
            } else {
                setFormState(normalized);
            }
            lastKnownUpdatedAtRef.current = toIsoTimestamp(profile?.updatedAt || profile?.updated_at);
            setHasChanges(false);
            setSaveState("idle");
            setSaveErrorMessage(null);
        }
    }, [open, profile?.id, profile?.updatedAt, profile?.updated_at]);

    useEffect(() => {
        if (!open || !formState || !profile?.id || typeof window === "undefined") return;
        const draftKey = `${DRAFT_KEY_PREFIX}${profile.id}`;
        const timer = window.setTimeout(() => {
            window.localStorage.setItem(draftKey, JSON.stringify(formState));
        }, 500);
        return () => window.clearTimeout(timer);
    }, [formState, open, profile?.id]);

    const applyOptimisticPatch = (payload: Record<string, unknown>) => {
        if (!onOptimisticUpdate) return;
        onOptimisticUpdate({
            fullName: payload.fullName,
            username: payload.username,
            headline: payload.headline,
            bio: payload.bio,
            location: payload.location,
            website: payload.website,
            avatarUrl: payload.avatarUrl,
            bannerUrl: payload.bannerUrl,
            skills: payload.skills,
            socialLinks: payload.socialLinks,
            availabilityStatus: payload.availabilityStatus,
            openTo: payload.openTo,
            experience: payload.experience,
            education: payload.education,
        });
    };

    const loadLatestServerProfileState = async () => {
        if (!profile?.id) return null;
        const supabase = createSupabaseBrowserClient();
        const { data, error } = await supabase
            .from("profiles")
            .select(`
                id,
                full_name,
                username,
                headline,
                bio,
                location,
                website,
                avatar_url,
                banner_url,
                availability_status,
                open_to,
                skills,
                social_links,
                experience,
                education,
                updated_at
            `)
            .eq("id", profile.id)
            .single();
        if (error || !data) return null;
        return {
            formState: toFormState(data),
            updatedAt: toIsoTimestamp(data.updated_at),
        };
    };

    const persistChanges = async (payload: Record<string, unknown>, closeOnSuccess: boolean) => {
        if (!formState || inFlightRef.current) return;
        inFlightRef.current = true;
        setSaveState("saving");
        setSaveErrorMessage(null);
        const rollbackPatch: Record<string, unknown> = {}
        try {
            for (const [key, value] of Object.entries(payload)) {
                if (key === "expectedUpdatedAt") continue;
                if (key === "fullName") rollbackPatch.fullName = baseProfileRef.current.full_name
                if (key === "username") rollbackPatch.username = baseProfileRef.current.username
                if (key === "headline") rollbackPatch.headline = baseProfileRef.current.headline
                if (key === "bio") rollbackPatch.bio = baseProfileRef.current.bio
                if (key === "location") rollbackPatch.location = baseProfileRef.current.location
                if (key === "website") rollbackPatch.website = baseProfileRef.current.website
                if (key === "avatarUrl") rollbackPatch.avatarUrl = baseProfileRef.current.avatar_url
                if (key === "bannerUrl") rollbackPatch.bannerUrl = baseProfileRef.current.banner_url
                if (key === "skills") rollbackPatch.skills = baseProfileRef.current.skills
                if (key === "socialLinks") rollbackPatch.socialLinks = baseProfileRef.current.socialLinks
                if (key === "availabilityStatus") rollbackPatch.availabilityStatus = baseProfileRef.current.availabilityStatus
                if (key === "openTo") rollbackPatch.openTo = baseProfileRef.current.openTo
                if (key === "experience") rollbackPatch.experience = baseProfileRef.current.experience
                if (key === "education") rollbackPatch.education = baseProfileRef.current.education
                void value;
            }

            applyOptimisticPatch(payload);
            const applyUpdate = async (nextPayload: Record<string, unknown>) => {
                const response = await updateProfileAction(nextPayload as any);
                if (response.success && typeof (response as any).updatedAt === "string") {
                    return { ok: true as const, response, payload: nextPayload };
                }
                return { ok: false as const, response };
            };

            let updateResult = await applyUpdate(payload);
            let retryBaseState: ReturnType<typeof toFormState> | null = null;
            const errorCode =
                !updateResult.ok
                    ? ((updateResult.response as any)?.errorCode || (updateResult.response as any)?.code)
                    : null;

            if (!updateResult.ok && errorCode === "PROFILE_CONFLICT") {
                const latest = await loadLatestServerProfileState();
                if (latest) {
                    const retryPayload = { ...payload, expectedUpdatedAt: latest.updatedAt };
                    updateResult = await applyUpdate(retryPayload);
                    if (updateResult.ok) {
                        retryBaseState = latest.formState;
                    }
                }
            }

            if (updateResult.ok) {
                const targetKeys = new Set<string>([
                    profile?.id || "",
                    profile?.username || "",
                    (payload.username as string | undefined) || "",
                ]);
                targetKeys.forEach((target) => {
                    if (!target) return;
                    queryClient.invalidateQueries({ queryKey: queryKeys.profile.byTarget(target) });
                });
                void refreshProfile().catch((refreshError) => {
                    console.warn("Profile refresh after save failed", {
                        profileId: profile?.id,
                        error:
                            refreshError instanceof Error
                                ? refreshError.message
                                : String(refreshError),
                    });
                });
                if (retryBaseState) {
                    baseProfileRef.current = retryBaseState;
                }
                lastKnownUpdatedAtRef.current = (updateResult.response as any).updatedAt || lastKnownUpdatedAtRef.current;
                baseProfileRef.current = applyPayloadToBaseState(baseProfileRef.current, updateResult.payload);
                const draftKey = `${DRAFT_KEY_PREFIX}${profile.id}`;
                if (typeof window !== "undefined") {
                    window.localStorage.removeItem(draftKey);
                }
                setHasChanges(false);
                setSaveState("success");
                showToast("Profile updated successfully", "success");
                if (closeOnSuccess) {
                    onOpenChange(false);
                }
            } else {
                applyOptimisticPatch(rollbackPatch);
                const message =
                    (updateResult.response as any)?.error ||
                    "Failed to update profile. Please review your changes and retry.";
                console.error("Profile save failed", {
                    profileId: profile?.id,
                    errorCode: (updateResult.response as any)?.errorCode || (updateResult.response as any)?.code || null,
                    message,
                });
                setSaveState("error");
                setSaveErrorMessage(message);
                showToast(message, "error");
            }
        } catch (error) {
            applyOptimisticPatch(rollbackPatch);
            console.error(error);
            const message = "An unexpected error occurred while saving your profile.";
            setSaveState("error");
            setSaveErrorMessage(message);
            showToast(message, "error");
        } finally {
            inFlightRef.current = false;
        }
    };

    const handleSave = async () => {
        if (!formState) return;
        const payload = buildActionPayload(formState, lastKnownUpdatedAtRef.current);
        await persistChanges(payload, true);
    };

    const handleSaveSection = async (section: EditSection) => {
        if (!formState) return;
        const payload = buildPartialPayload(formState, section, lastKnownUpdatedAtRef.current);
        await persistChanges(payload, false);
    };

    const handleResetSection = (section: EditSection) => {
        if (!formState) return;
        const keys = sectionKeys(section);
        const next = { ...formState };
        for (const key of keys) {
            next[key] = baseProfileRef.current[key];
        }
        setFormState(next);
        setHasChanges(hasFormChanges(next, baseProfileRef.current));
    };

    const usernameChanged = Boolean(
        formState?.username &&
            baseProfileRef.current?.username &&
            formState.username !== baseProfileRef.current.username
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px] h-[640px] max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
                <DialogHeader className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800">
                    <DialogTitle className="flex items-center justify-between">
                        <span>Edit Profile</span>
                        <span className="text-xs font-normal text-zinc-500">{completion.score}% complete</span>
                    </DialogTitle>
                    <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                        <div
                            className="h-full bg-indigo-600 transition-all"
                            style={{ width: `${completion.score}%` }}
                        />
                    </div>
                    {usernameChanged ? (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                            Changing username can break old profile links and mentions. Username changes are rate limited.
                        </p>
                    ) : null}
                </DialogHeader>

                <div className="flex-1 min-h-0">
                    <EditProfileTabs
                        profile={formState || profile}
                        onChange={(updates) => {
                            setFormState(updates);
                            setHasChanges(true);
                            if (saveState !== "saving") {
                                setSaveState("idle");
                                setSaveErrorMessage(null);
                            }
                        }}
                        onSaveSection={handleSaveSection}
                        onResetSection={handleResetSection}
                    />
                </div>

                <DialogFooter className="px-6 py-4 border-t border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-b-lg">
                    {saveErrorMessage ? (
                        <p className="mr-auto text-xs text-red-500">{saveErrorMessage}</p>
                    ) : null}
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saveState === "saving"}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={saveState === "saving" || !hasChanges}>
                        {saveState === "saving" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        Save Changes
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
