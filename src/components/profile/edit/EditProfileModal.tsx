"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { EditProfileTabs, type EditProfileSection } from "./EditProfileTabs";
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
    onOptimisticUpdate?: (updates: any) => void;
    initialSection?: EditProfileSection;
}

type SaveState = "idle" | "saving" | "success" | "error";

import { toFormState, toServerPayload, applyPayloadToFormBase } from "@/lib/profile/normalization";

function toIsoTimestamp(value: unknown): string {
    if (typeof value === "string" && value.trim()) return value;
    if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
    return new Date().toISOString();
}

export function EditProfileModal({ open, onOpenChange, profile, onOptimisticUpdate, initialSection = "general" }: EditProfileModalProps) {
    const { showToast } = useToast();
    const queryClient = useQueryClient();
    const { refreshProfile } = useAuth();
    const [formState, setFormState] = useState<any>(null);
    const [saveState, setSaveState] = useState<SaveState>("idle");
    const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
    const [hasChanges, setHasChanges] = useState(false);
    const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
    const [activeSection, setActiveSection] = useState<EditProfileSection>(initialSection);
    const inFlightRef = useRef(false);
    const wasOpenRef = useRef(false);
    const lastKnownUpdatedAtRef = useRef<string>(
        toIsoTimestamp(profile?.updatedAt || profile?.updated_at)
    );
    const baseProfileRef = useRef<any>(toFormState(profile));
    const originalUsernameRef = useRef<string>(toFormState(profile).username || "");

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
            originalUsernameRef.current = normalized.username || "";
            setFormState(normalized);
            lastKnownUpdatedAtRef.current = toIsoTimestamp(profile?.updatedAt || profile?.updated_at);
            setHasChanges(false);
            setSaveState("idle");
            setSaveErrorMessage(null);
            setShowDiscardConfirm(false);
            setActiveSection(initialSection);
        }
    }, [initialSection, open, profile?.id, profile?.updatedAt, profile?.updated_at]);

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
                baseProfileRef.current = applyPayloadToFormBase(baseProfileRef.current, updateResult.payload);
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
        const payload = toServerPayload(formState, lastKnownUpdatedAtRef.current);
        await persistChanges(payload, true);
    };

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        await handleSave();
    };

    // Section saves removed in favor of global save

    // Section resets removed

    const handleOpenChange = (openValue: boolean) => {
        if (!openValue && hasChanges && !showDiscardConfirm) {
            setShowDiscardConfirm(true);
            return;
        }
        if (!openValue) {
            setShowDiscardConfirm(false);
        }
        onOpenChange(openValue);
    };

    const usernameChanged = Boolean(
        formState?.username &&
            baseProfileRef.current?.username &&
            formState.username !== baseProfileRef.current.username
    );

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-4xl h-[700px] max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 rounded-2xl">
                <DialogHeader className="px-6 py-4 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 z-10">
                    <DialogTitle className="flex items-center justify-between">
                        <span>Edit Profile</span>
                        <span className="text-xs font-normal text-zinc-500">{completion.score}% complete</span>
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        Edit your profile information, work experience, education, skills, and social presence.
                    </DialogDescription>
                    <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden mt-3">
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

                <form className="flex-1 min-h-0 flex flex-col" onSubmit={handleSubmit} aria-label="Edit profile form">
                    <div className="flex-1 min-h-0 flex flex-col md:flex-row w-full overflow-hidden">
                        <EditProfileTabs
                            profile={formState || profile}
                            originalUsername={originalUsernameRef.current}
                            section={activeSection}
                            onSectionChange={setActiveSection}
                            onChange={(updates) => {
                                setFormState(updates);
                                setHasChanges(true);
                                if (saveState !== "saving") {
                                    setSaveState("idle");
                                    setSaveErrorMessage(null);
                                }
                            }}
                        />
                    </div>

                    <DialogFooter className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 z-10">
                        {showDiscardConfirm ? (
                            <>
                                <p className="mr-auto text-sm font-medium text-zinc-900 dark:text-zinc-100 flex items-center">
                                    Discard unsaved changes?
                                </p>
                                <Button type="button" variant="ghost" onClick={() => setShowDiscardConfirm(false)}>
                                    Keep Editing
                                </Button>
                                <Button type="button" variant="danger" onClick={() => handleOpenChange(false)}>
                                    Discard
                                </Button>
                            </>
                        ) : (
                            <>
                                {saveErrorMessage ? (
                                    <p className="mr-auto text-xs text-red-500">{saveErrorMessage}</p>
                                ) : null}
                                <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={saveState === "saving"}>
                                    Cancel
                                </Button>
                                <Button type="submit" disabled={saveState === "saving" || !hasChanges}>
                                    {saveState === "saving" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                    Save Changes
                                </Button>
                            </>
                        )}
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
