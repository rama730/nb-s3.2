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

interface EditProfileModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    profile: any;
    // Optimistic update callback
    onOptimisticUpdate?: (updates: any) => void;
}

type EditSection = "general" | "experience" | "education" | "skills" | "social";

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
        expectedUpdatedAt,
    };
}

function buildPartialPayload(formState: any, section: EditSection, expectedUpdatedAt?: string) {
    const keys = sectionKeys(section);
    const payload = buildActionPayload(formState, expectedUpdatedAt) as Record<string, unknown>;
    const partial: Record<string, unknown> = { expectedUpdatedAt };
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
    const [saving, setSaving] = useState(false);
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

    const persistChanges = async (payload: Record<string, unknown>, closeOnSuccess: boolean) => {
        if (!formState || inFlightRef.current) return;
        inFlightRef.current = true;
        setSaving(true);
        try {
            const rollbackPatch: Record<string, unknown> = {}
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
            const res = await updateProfileAction(payload as any);
            if (res.success) {
                queryClient.invalidateQueries({ queryKey: ['profile'] });
                await refreshProfile();
                lastKnownUpdatedAtRef.current = (res as any).updatedAt || lastKnownUpdatedAtRef.current;
                baseProfileRef.current = applyPayloadToBaseState(baseProfileRef.current, payload);
                const draftKey = `${DRAFT_KEY_PREFIX}${profile.id}`;
                if (typeof window !== "undefined") {
                    window.localStorage.removeItem(draftKey);
                }
                setHasChanges(false);
                showToast("Profile updated successfully", "success");
                if (closeOnSuccess) {
                    onOpenChange(false);
                }
            } else {
                applyOptimisticPatch(rollbackPatch);
                showToast(res.error || "Failed to update profile", "error");
            }
        } catch (error) {
            console.error(error);
            showToast("An unexpected error occurred", "error");
        } finally {
            setSaving(false);
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
                        }}
                        onSaveSection={handleSaveSection}
                        onResetSection={handleResetSection}
                    />
                </div>

                <DialogFooter className="px-6 py-4 border-t border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-b-lg">
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={saving || !hasChanges}>
                        {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        Save Changes
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
