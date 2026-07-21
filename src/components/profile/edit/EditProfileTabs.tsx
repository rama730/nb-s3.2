"use client";

import { toast } from "sonner";
import { useId, useState } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import { Loader2, Camera, Plus, X, Trash2, CheckCircle2, AlertTriangle, Briefcase, Calendar, Link as LinkIcon, Code, Github, ChevronDown } from "lucide-react";
import { createProfileImageUploadUrlAction, finalizeProfileImageUploadAction } from "@/app/actions/profile";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { sanitizeUsernameInput } from "@/lib/validations/username";
import { useUsernameAvailability } from "@/hooks/useUsernameAvailability";
import { PROFILE_LIMITS } from "@/lib/validations/profile";
import { uploadToSupabaseSignedUrl } from "@/lib/upload/supabase-signed-upload-client";
import {
    EXPERIENCE_LEVEL_OPTIONS,
    ROLE_PREFERENCE_OPTIONS,
    WEEKLY_CAPACITY_OPTIONS,
    getRolePreferences,
    replaceRolePreferences,
} from "@/lib/profile/role-preferences";
import {
    contributionEntryChanged,
    createExternalContributionDraft,
    type ContributionEditorEntry,
} from "@/lib/profile/contribution-editor";

const SkillPicker = dynamic(() => import("@/components/skills/SkillPicker").then((mod) => mod.SkillPicker), {
    ssr: false,
    loading: () => <div className="h-24 rounded-xl bg-zinc-100 dark:bg-zinc-900" />,
});

export type EditProfileSection = "general" | "experience" | "education" | "skills" | "social" | "opportunity";

interface EditProfileTabsProps {
    profile: any;
    originalUsername: string;
    section: EditProfileSection;
    onSectionChange: (section: EditProfileSection) => void;
    onChange: (updates: any) => void;
    contributionErrors?: Record<string, string>;
    contributionsSaving?: boolean;
    contributionsLoadingMore?: boolean;
    contributionHasMore?: boolean;
    contributionTotal?: number;
    onLoadMoreContributions?: () => void;
}

export function EditProfileTabs({
    profile,
    originalUsername,
    section,
    onSectionChange,
    onChange,
    contributionErrors = {},
    contributionsSaving = false,
    contributionsLoadingMore = false,
    contributionHasMore = false,
    contributionTotal = 0,
    onLoadMoreContributions,
}: EditProfileTabsProps) {
    const [avatarUploading, setAvatarUploading] = useState(false);

    const { status: usernameStatus, message: usernameMessage } = useUsernameAvailability({
        value: profile.username,
        currentUsername: originalUsername,
        debounceMs: 500,
    });

    const updateForm = (key: string, value: any) => {
        onChange({ ...profile, [key]: value });
    };

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setAvatarUploading(true);

        try {
            const uploadSession = await createProfileImageUploadUrlAction({
                mimeType: file.type || "application/octet-stream",
                sizeBytes: file.size,
                kind: "avatar",
            });
            if (!uploadSession.success) {
                throw new Error(uploadSession.error || "Failed to prepare image upload");
            }

            await uploadToSupabaseSignedUrl(uploadSession, file);

            const finalized = await finalizeProfileImageUploadAction({
                uploadIntentId: uploadSession.uploadIntentId,
            });
            if (!finalized.success) {
                throw new Error(finalized.error || "Failed to finalize image upload");
            }

            const cacheBustedUrl = `${finalized.publicUrl}?t=${Date.now()}`;
            updateForm("avatarUrl", cacheBustedUrl);
            toast.success("Avatar updated");
        } catch (error: any) {
            const message = error?.message || "Unknown error";
            toast.error(`Failed to upload avatar: ${message}`);
        } finally {
            setAvatarUploading(false);
        }
    };

    const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        updateForm("username", sanitizeUsernameInput(e.target.value));
    };

    return (
        <Tabs
            value={section}
            onValueChange={(value) => onSectionChange(value as EditProfileSection)}
            className="w-full h-full flex flex-col md:flex-row"
            orientation="vertical"
        >
            <div className="w-full md:w-64 shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-4 md:p-6 overflow-y-auto">
                <TabsList className="flex flex-col h-auto w-full bg-transparent space-y-1 p-0">
                    <TabsTrigger value="general" className="w-full justify-start px-3 py-2 text-sm font-medium data-[state=active]:bg-zinc-100 dark:data-[state=active]:bg-zinc-800 data-[state=active]:shadow-none rounded-lg text-zinc-600 data-[state=active]:text-zinc-900 dark:text-zinc-400 dark:data-[state=active]:text-zinc-100">
                        General Properties
                    </TabsTrigger>
                    <TabsTrigger value="experience" className="w-full justify-start px-3 py-2 text-sm font-medium data-[state=active]:bg-zinc-100 dark:data-[state=active]:bg-zinc-800 data-[state=active]:shadow-none rounded-lg text-zinc-600 data-[state=active]:text-zinc-900 dark:text-zinc-400 dark:data-[state=active]:text-zinc-100">
                        Project Contributions
                    </TabsTrigger>
                    <TabsTrigger value="skills" className="w-full justify-start px-3 py-2 text-sm font-medium data-[state=active]:bg-zinc-100 dark:data-[state=active]:bg-zinc-800 data-[state=active]:shadow-none rounded-lg text-zinc-600 data-[state=active]:text-zinc-900 dark:text-zinc-400 dark:data-[state=active]:text-zinc-100">
                        Skills & Expertise
                    </TabsTrigger>
                    <TabsTrigger value="social" className="w-full justify-start px-3 py-2 text-sm font-medium data-[state=active]:bg-zinc-100 dark:data-[state=active]:bg-zinc-800 data-[state=active]:shadow-none rounded-lg text-zinc-600 data-[state=active]:text-zinc-900 dark:text-zinc-400 dark:data-[state=active]:text-zinc-100">
                        Social Presence
                    </TabsTrigger>
                    <TabsTrigger value="opportunity" className="w-full justify-start px-3 py-2 text-sm font-medium data-[state=active]:bg-zinc-100 dark:data-[state=active]:bg-zinc-800 data-[state=active]:shadow-none rounded-lg text-zinc-600 data-[state=active]:text-zinc-900 dark:text-zinc-400 dark:data-[state=active]:text-zinc-100">
                        Role Preferences
                    </TabsTrigger>
                </TabsList>
            </div>

            <div className="flex-1 app-scroll app-scroll-y p-6 md:p-10 bg-zinc-50 dark:bg-zinc-950">
                <div className="max-w-2xl mx-auto w-full">
                    <TabsContent value="general" className="space-y-4 mt-0">
                        <div className="space-y-4">
                            <div className="flex flex-col items-center sm:items-start pb-4">
                                <h2 className="text-xl font-semibold text-zinc-900 dark:text-white mb-6">General Properties</h2>
                                <div className="flex items-center gap-5 relative z-10 w-full">
                                    <div className="w-20 h-20 rounded-2xl bg-zinc-200 dark:bg-zinc-800 border-4 border-white dark:border-zinc-900 overflow-hidden relative group shrink-0">
                                        {profile.avatarUrl ? (
                                            <Image src={profile.avatarUrl} alt="Profile avatar" fill className="object-cover" sizes="80px" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-zinc-400">
                                                {(profile.fullName?.[0] || profile.username?.[0] || "?").toUpperCase()}
                                            </div>
                                        )}
                                        <label className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center cursor-pointer transition-opacity text-white">
                                            {avatarUploading ? <Loader2 className="w-6 h-6 animate-spin mb-1" /> : <Camera className="w-6 h-6 mb-1" />}
                                            <span className="text-xs font-medium">{avatarUploading ? "Uploading..." : "Change"}</span>
                                            <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={avatarUploading} />
                                        </label>
                                    </div>
                                    <div className="flex flex-col">
                                        <h3 className="font-semibold text-base">Profile Photo</h3>
                                        <p className="text-sm text-zinc-500 mt-1">Recommended size: 400x400px. Max 5MB.</p>
                                    </div>
                                </div>
                            </div>

                            <div className="grid gap-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label htmlFor="profile-full-name" className="text-sm font-medium leading-none">Full Name</label>
                                        <Input
                                            id="profile-full-name"
                                            name="fullName"
                                            required
                                            minLength={1}
                                            maxLength={PROFILE_LIMITS.fullNameMax}
                                            value={profile.fullName ?? ""}
                                            onChange={(e) => updateForm("fullName", e.target.value)}
                                            className="mt-1.5"
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="profile-username" className="text-sm font-medium leading-none">Username</label>
                                        <div className="relative mt-1.5">
                                            <Input
                                                id="profile-username"
                                                name="username"
                                                required
                                                minLength={PROFILE_LIMITS.usernameMin}
                                                maxLength={PROFILE_LIMITS.usernameMax}
                                                pattern="(?:[a-z0-9_]|-)+"
                                                value={profile.username ?? ""}
                                                onChange={handleUsernameChange}
                                                className={cn(
                                                    usernameStatus === "invalid" && "border-red-500 ",
                                                    usernameStatus === "valid" && "border-green-500 ",
                                                )}
                                            />
                                            {usernameStatus === "checking" ? (
                                                <Loader2 className="absolute right-3 top-2.5 w-4 h-4 animate-spin text-zinc-400" />
                                            ) : null}
                                        </div>

                                        {usernameMessage ? (
                                            <p className={cn(
                                                "text-xs mt-2 font-medium flex items-center gap-1.5",
                                                usernameStatus === "valid" && "text-emerald-600 dark:text-emerald-500",
                                                usernameStatus === "checking" && "text-zinc-500 dark:text-zinc-400",
                                                usernameStatus === "invalid" && "text-red-500",
                                                usernameStatus === "error" && "text-amber-600 dark:text-amber-400",
                                            )}>
                                                {usernameStatus === "valid" ? (
                                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                                ) : usernameStatus === "checking" ? (
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                ) : (
                                                    <X className="w-3.5 h-3.5" />
                                                )}
                                                {usernameMessage}
                                            </p>
                                        ) : null}

                                        <div className="mt-3 flex items-start gap-3 rounded-2xl border border-amber-200/50 bg-amber-50/50 dark:border-amber-900/30 dark:bg-amber-900/20 p-4 text-[13px] text-amber-900 dark:text-amber-200 shadow-sm">
                                            <div className="mt-0.5 bg-amber-100 dark:bg-amber-900/50 p-1 rounded-lg">
                                                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                                            </div>
                                            <div className="space-y-1">
                                                <p className="font-semibold">Changing your identity</p>
                                                <p className="leading-relaxed opacity-80 text-xs">Your public handle updates immediately. Cached mentions may take a little time to refresh.</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <label htmlFor="profile-headline" className="text-sm font-medium leading-none">Headline</label>
                                        <Input
                                            id="profile-headline"
                                            name="headline"
                                            maxLength={PROFILE_LIMITS.headlineMax}
                                            value={profile.headline ?? ""}
                                            onChange={(e) => updateForm("headline", e.target.value)}
                                            placeholder="e.g. Senior Frontend Engineer"
                                            className="mt-1.5"
                                    />
                                </div>

                                <div>
                                    <label htmlFor="profile-bio" className="text-sm font-medium leading-none">Bio</label>
                                        <textarea
                                            id="profile-bio"
                                            name="bio"
                                            maxLength={PROFILE_LIMITS.bioMax}
                                            value={profile.bio ?? ""}
                                            onChange={(e) => updateForm("bio", e.target.value)}
                                            className="w-full mt-1.5 min-h-[100px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-2 text-sm outline-none  "
                                            placeholder="Tell your story..."
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label htmlFor="profile-location" className="text-zinc-600 dark:text-zinc-400">Location</label>
                                        <Input
                                            id="profile-location"
                                            name="location"
                                            maxLength={PROFILE_LIMITS.locationMax}
                                            value={profile.location ?? ""}
                                            onChange={(e) => updateForm("location", e.target.value)}
                                            placeholder="City, Country"
                                            className="mt-1.5"
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="profile-website" className="text-zinc-600 dark:text-zinc-400">Website</label>
                                        <Input
                                            id="profile-website"
                                            name="website"
                                            type="url"
                                            pattern="https?://.*"
                                            maxLength={PROFILE_LIMITS.websiteMax}
                                            value={profile.website ?? ""}
                                            onChange={(e) => updateForm("website", e.target.value)}
                                            placeholder="https://"
                                            className="mt-1.5"
                                        />
                                    </div>
                                </div>

                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="experience" className="space-y-6 mt-0">
                        <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">Project Contributions</h2>
                        <ProjectContributionsList
                            items={profile.experience ?? []}
                            originalItems={profile.contributionBase ?? []}
                            onChange={(items) => updateForm("experience", items)}
                            errors={contributionErrors}
                            saving={contributionsSaving}
                            loadingMore={contributionsLoadingMore}
                            hasMore={contributionHasMore}
                            total={contributionTotal}
                            onLoadMore={onLoadMoreContributions}
                        />
                    </TabsContent>



                    <TabsContent value="skills" className="space-y-6 mt-0">
                        <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">Skills & Expertise</h2>
                        <SkillsEditor
                            skills={profile.skills ?? []}
                            onChange={(skills) => updateForm("skills", skills)}
                        />
                    </TabsContent>

                    <TabsContent value="social" className="space-y-6 mt-0">
                        <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">Social Presence</h2>
                        <SocialLinksEditor
                            links={profile.socialLinks ?? {}}
                            onChange={(links) => updateForm("socialLinks", links)}
                        />
                    </TabsContent>

                    <TabsContent value="opportunity" className="space-y-6 mt-0">
                        <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">Role Preferences</h2>
                        <RolePreferencesEditor profile={profile} onChange={onChange} />
                    </TabsContent>
                </div>
            </div>
        </Tabs>
    );
}

function RolePreferencesEditor({ profile, onChange }: { profile: any; onChange: (updates: any) => void }) {
    const selectedRoles = new Set(getRolePreferences(profile.openTo))
    const hasPreferences = selectedRoles.size > 0 || Boolean(profile.experienceLevel) || Boolean(profile.hoursPerWeek) || (profile.openToCustomRoles && profile.openToCustomRoles.length > 0) || (profile.preferredCategories && profile.preferredCategories.length > 0)
    const [customRoleInput, setCustomRoleInput] = useState("");

    const toggleRole = (role: string) => {
        const next = new Set(selectedRoles)
        if (next.has(role as any)) next.delete(role as any)
        else next.add(role as any)
        onChange({
            ...profile,
            openTo: replaceRolePreferences(profile.openTo, [...next]),
        })
    }

    const customRoles = profile.openToCustomRoles || [];
    const categories = profile.preferredCategories || [];

    const handleAddCustomRole = () => {
        const trimmed = customRoleInput.trim();
        if (trimmed && !customRoles.includes(trimmed)) {
            onChange({
                ...profile,
                openToCustomRoles: [...customRoles, trimmed],
            });
        }
        setCustomRoleInput("");
    };

    const handleRemoveCustomRole = (role: string) => {
        onChange({
            ...profile,
            openToCustomRoles: customRoles.filter((r: string) => r !== role),
        });
    };

    const toggleCategory = (category: string) => {
        const next = new Set(categories);
        if (next.has(category)) {
            next.delete(category);
        } else {
            next.add(category);
        }
        onChange({
            ...profile,
            preferredCategories: [...next],
        });
    };

    const ROLE_CATEGORIES = ["Engineering", "Design", "Product", "Growth"] as const;

    return (
        <section aria-labelledby="role-preferences-heading" className="space-y-6">
            <div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Define the custom roles, commitment levels, and categories visitors should see on your builder profile.
                </p>
            </div>

            <div className="space-y-3">
                <label className="text-zinc-700 dark:text-zinc-300 font-medium">Standard Availability Type</label>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Role types">
                    {ROLE_PREFERENCE_OPTIONS.map((option) => {
                        const selected = selectedRoles.has(option.value)
                        return (
                            <button
                                key={option.value}
                                type="button"
                                aria-pressed={selected}
                                onClick={() => toggleRole(option.value)}
                                className={cn(
                                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                                    selected
                                        ? "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300"
                                        : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800",
                                )}
                            >
                                {option.label}
                            </button>
                        )
                    })}
                </div>
            </div>

            <div className="space-y-3">
                <label className="text-zinc-700 dark:text-zinc-300 font-medium">Role Categories</label>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Role categories">
                    {ROLE_CATEGORIES.map((category) => {
                        const selected = categories.includes(category);
                        return (
                            <button
                                key={category}
                                type="button"
                                aria-pressed={selected}
                                onClick={() => toggleCategory(category)}
                                className={cn(
                                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                                    selected
                                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                                        : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800",
                                )}
                            >
                                {category}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="space-y-3">
                <label className="text-zinc-700 dark:text-zinc-300 font-medium">Custom Role Desired Titles</label>
                <div className="flex gap-2">
                    <Input
                        value={customRoleInput}
                        onChange={(e) => setCustomRoleInput(e.target.value)}
                        placeholder="e.g. Next.js Developer, Rust Dev"
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                handleAddCustomRole();
                            }
                        }}
                        className="flex-1"
                    />
                    <Button type="button" onClick={handleAddCustomRole}>Add</Button>
                </div>
                {customRoles.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                        {customRoles.map((role: string) => (
                            <span
                                key={role}
                                className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700"
                            >
                                {role}
                                <button
                                    type="button"
                                    onClick={() => handleRemoveCustomRole(role)}
                                    className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </span>
                        ))}
                    </div>
                )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
                    <span>Experience level</span>
                    <select
                        value={profile.experienceLevel ?? ''}
                        onChange={(event) => onChange({ ...profile, experienceLevel: event.target.value || null })}
                        className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none   dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                    >
                        <option value="">Not specified</option>
                        {EXPERIENCE_LEVEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                </label>
                <label className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
                    <span>Weekly capacity</span>
                    <select
                        value={profile.hoursPerWeek ?? ''}
                        onChange={(event) => onChange({ ...profile, hoursPerWeek: event.target.value || null })}
                        className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none   dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                    >
                        <option value="">Not specified</option>
                        {WEEKLY_CAPACITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                </label>
            </div>

            {hasPreferences ? (
                <button
                    type="button"
                    onClick={() => onChange({
                        ...profile,
                        openTo: replaceRolePreferences(profile.openTo, []),
                        openToCustomRoles: [],
                        preferredCategories: [],
                        experienceLevel: null,
                        hoursPerWeek: null,
                    })}
                    className="text-sm font-medium text-zinc-500 hover:text-rose-600 dark:text-zinc-400 dark:hover:text-rose-400"
                >
                    Clear role preferences
                </button>
            ) : null}
        </section>
    )
}

function ProjectContributionsList({
    items = [],
    originalItems = [],
    onChange,
    errors = {},
    saving = false,
    loadingMore = false,
    hasMore = false,
    total = 0,
    onLoadMore,
}: {
    items: ContributionEditorEntry[];
    originalItems: ContributionEditorEntry[];
    onChange: (items: ContributionEditorEntry[]) => void;
    errors?: Record<string, string>;
    saving?: boolean;
    loadingMore?: boolean;
    hasMore?: boolean;
    total?: number;
    onLoadMore?: () => void;
}) {
    const [expandedKey, setExpandedKey] = useState<string | null>(null);
    const accordionId = useId().replace(/:/g, "");
    const originalById = new Map(originalItems.map((item) => [item.draftId, item]));

    const updateItem = (draftId: string, updates: Partial<ContributionEditorEntry>) => {
        onChange(items.map((item) => item.draftId === draftId ? { ...item, ...updates } : item));
    };

    const handleAddExternal = () => {
        const draft = createExternalContributionDraft();
        onChange([...items, draft]);
        setExpandedKey(draft.draftId);
    };

    const handleDeleteExternal = (draftId: string) => {
        onChange(items.filter((item) => item.draftId !== draftId));
        setExpandedKey((current) => current === draftId ? null : current);
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Your contributions</h3>
                    <p className="mt-1 text-xs text-zinc-500">
                        Open one project at a time. Platform project names and roles come from the project team.
                        {total > 0 ? ` Showing ${Math.min(items.length, total)} of ${total}.` : ""}
                    </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={handleAddExternal}>
                    <Plus className="mr-1 h-4 w-4" /> Add external project
                </Button>
            </div>

            {items.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-300 px-5 py-8 text-center dark:border-zinc-700">
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">No project contributions yet</p>
                    <p className="mt-1 text-xs text-zinc-500">Platform contributions appear after you join a project. You can also add an external project.</p>
                </div>
            ) : null}

            <div className="space-y-3">
                {items.map((item) => {
                    const isPublic = item.visibility === "public";
                    const isExpanded = expandedKey === item.draftId;
                    const panelId = `${accordionId}-contribution-${item.draftId}`;
                    const isDirty = contributionEntryChanged(item, originalById.get(item.draftId));
                    const itemError = errors[item.draftId];
                    return (
                        <div key={item.draftId} className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950/40">
                            <button
                                type="button"
                                aria-expanded={isExpanded}
                                aria-controls={panelId}
                                onClick={() => setExpandedKey((current) => current === item.draftId ? null : item.draftId)}
                                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-zinc-900/60"
                            >
                                <span className="min-w-0">
                                    <span className="block truncate font-semibold text-zinc-900 dark:text-white">{item.projectTitle || "Untitled external project"}</span>
                                    <span className="mt-1 block truncate text-xs text-zinc-500">{item.roleTitle || "Role not specified"}</span>
                                </span>
                                <span className="flex shrink-0 items-center gap-2">
                                    {itemError ? <span className="text-xs font-medium text-red-600 dark:text-red-400">Needs attention</span> : null}
                                    {!itemError && saving && isDirty ? <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">Saving…</span> : null}
                                    {!itemError && !saving && isDirty ? <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Unsaved</span> : null}
                                    {!isPublic ? <span className="text-xs text-zinc-500">Private</span> : null}
                                    <ChevronDown className={`h-4 w-4 text-zinc-500 transition-transform ${isExpanded ? "rotate-180" : ""}`} aria-hidden="true" />
                                </span>
                            </button>

                            {isExpanded ? (
                                <div id={panelId} className="space-y-5 border-t border-zinc-200 p-5 dark:border-zinc-800">
                                    {itemError ? (
                                        <p role="alert" aria-live="assertive" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                                            {itemError}
                                        </p>
                                    ) : null}
                                    {item.kind === "external" ? (
                                        <div className="flex justify-end">
                                            <Button type="button" variant="ghost" size="sm" onClick={() => handleDeleteExternal(item.draftId)} className="h-8 px-2 text-zinc-500 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30">
                                                <Trash2 className="mr-1.5 h-4 w-4" /> Remove
                                            </Button>
                                        </div>
                                    ) : null}

                                    <div className="flex items-center justify-between rounded-xl border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800/30 dark:bg-zinc-900/50">
                                        <div className="space-y-0.5">
                                            <span className="text-sm font-semibold text-zinc-900 dark:text-white">Show publicly on profile</span>
                                            <p className="text-xs text-zinc-500">Off keeps this contribution visible only to you.</p>
                                        </div>
                                        <button
                                            type="button"
                                            role="switch"
                                            aria-checked={isPublic}
                                            aria-label={`${isPublic ? "Hide" : "Show"} ${item.projectTitle || "project contribution"} on profile`}
                                            onClick={() => updateItem(item.draftId, { visibility: isPublic ? "private" : "public" })}
                                            className={`${isPublic ? "bg-indigo-600" : "bg-zinc-200 dark:bg-zinc-800"} relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent outline-none transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2`}
                                        >
                                            <span aria-hidden="true" className={`${isPublic ? "translate-x-5" : "translate-x-0"} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition`} />
                                        </button>
                                    </div>

                                    {item.kind === "platform" ? (
                                        <dl className="grid grid-cols-1 gap-4 rounded-xl bg-zinc-50 p-4 md:grid-cols-2 dark:bg-zinc-900/50">
                                            <div><dt className="text-xs text-zinc-500">Project</dt><dd className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.projectTitle}</dd></div>
                                            <div><dt className="text-xs text-zinc-500">Your role</dt><dd className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">{item.roleTitle}</dd></div>
                                        </dl>
                                    ) : (
                                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                            <div>
                                                <label htmlFor={`${panelId}-project`} className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400"><Briefcase className="h-3.5 w-3.5" /> Project name</label>
                                                <Input id={`${panelId}-project`} maxLength={120} value={item.projectTitle} onChange={(event) => updateItem(item.draftId, { projectTitle: event.target.value })} className="mt-1.5 h-10" />
                                            </div>
                                            <div>
                                                <label htmlFor={`${panelId}-role`} className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400"><Code className="h-3.5 w-3.5" /> Your role</label>
                                                <Input id={`${panelId}-role`} maxLength={120} value={item.roleTitle} onChange={(event) => updateItem(item.draftId, { roleTitle: event.target.value })} className="mt-1.5 h-10" />
                                            </div>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                        <div>
                                            <label htmlFor={`${panelId}-start`} className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400"><Calendar className="h-3.5 w-3.5" /> Joined</label>
                                            <Input id={`${panelId}-start`} type="month" value={item.startedAt} onChange={(event) => updateItem(item.draftId, { startedAt: event.target.value })} className="mt-1.5 h-10" />
                                        </div>
                                        <div>
                                            <label htmlFor={`${panelId}-end`} className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400"><Calendar className="h-3.5 w-3.5" /> Ended (optional)</label>
                                            <Input id={`${panelId}-end`} type="month" value={item.endedAt} onChange={(event) => updateItem(item.draftId, { endedAt: event.target.value })} className="mt-1.5 h-10" />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                        {item.kind === "external" ? (
                                            <div>
                                                <label htmlFor={`${panelId}-url`} className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400"><LinkIcon className="h-3.5 w-3.5" /> Project URL</label>
                                                <Input id={`${panelId}-url`} type="url" value={item.projectUrl} onChange={(event) => updateItem(item.draftId, { projectUrl: event.target.value })} className="mt-1.5 h-10" placeholder="https://" />
                                            </div>
                                        ) : <div />}
                                        <div>
                                            <label htmlFor={`${panelId}-repo`} className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400"><Github className="h-3.5 w-3.5" /> Repository URL</label>
                                            <Input id={`${panelId}-repo`} type="url" value={item.repositoryUrl} onChange={(event) => updateItem(item.draftId, { repositoryUrl: event.target.value })} className="mt-1.5 h-10" placeholder="https://github.com/..." />
                                        </div>
                                    </div>

                                    <SkillPicker value={item.skills} onChange={(skills) => updateItem(item.draftId, { skills })} maxSkills={20} label="Skills & tools" description="Choose the skills demonstrated in this contribution." placeholder="Search skills" />

                                    <div>
                                        <label htmlFor={`${panelId}-summary`} className="text-zinc-600 dark:text-zinc-400">Contribution summary</label>
                                        <textarea id={`${panelId}-summary`} maxLength={2000} className="mt-1.5 min-h-[96px] w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none focus:bg-white dark:border-zinc-800 dark:bg-zinc-900 dark:focus:bg-zinc-950" value={item.summary} onChange={(event) => updateItem(item.draftId, { summary: event.target.value })} placeholder="What did you build, improve, or lead?" />
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    );
                })}
            </div>

            {hasMore && onLoadMore ? (
                <div className="flex justify-center border-t border-zinc-200 pt-4 dark:border-zinc-800">
                    <Button type="button" variant="outline" size="sm" onClick={onLoadMore} disabled={loadingMore || saving}>
                        {loadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                        {loadingMore ? "Loading contributions…" : "Load more contributions"}
                    </Button>
                </div>
            ) : null}
        </div>
    );
}

function SkillsEditor({ skills, onChange }: { skills: string[]; onChange: (skills: string[]) => void }) {
    return <SkillPicker value={skills} onChange={onChange} maxSkills={25} />;
}

function SocialLinksEditor({ links, onChange }: { links: Record<string, string>; onChange: (links: Record<string, string>) => void }) {
    const entries = Object.entries(links);
    const platforms = ["Twitter", "GitHub", "LinkedIn", "Instagram", "Website", "Portfolio", "Other"];
    const [newPlatform, setNewPlatform] = useState(platforms[0]!);
    const [newUrl, setNewUrl] = useState("");
    const isValidSocialUrl = (url: string) => /^https?:\/\/.+/.test(url);
    const trimmedNewUrl = newUrl.trim();
    const canAddSocialLink = Boolean(trimmedNewUrl) && isValidSocialUrl(trimmedNewUrl);

    const handleAdd = () => {
        if (!canAddSocialLink) return;
        onChange({ ...links, [newPlatform.toLowerCase()]: trimmedNewUrl });
        setNewUrl("");
    };

    const remove = (key: string) => {
        const next = { ...links };
        delete next[key];
        onChange(next);
    };

    return (
        <div className="space-y-4">
            <div className="space-y-3">
                {entries.map(([key, url]) => (
                    <div key={key} className="flex items-center gap-2">
                        <div className="w-24 shrink-0 text-sm font-medium capitalize text-zinc-700 dark:text-zinc-300">{key}</div>
                        <Input value={url} readOnly className="flex-1 bg-zinc-50 dark:bg-zinc-900/50" />
                        <Button type="button" variant="ghost" size="sm" onClick={() => remove(key)} className="px-2">
                            <Trash2 className="w-4 h-4 text-zinc-400" />
                        </Button>
                    </div>
                ))}
            </div>

            <div className="flex gap-2 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                <select
                    value={newPlatform}
                    onChange={(e) => setNewPlatform(e.target.value)}
                    className="h-10 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 text-sm outline-none"
                >
                    {platforms.map((platform) => <option key={platform} value={platform}>{platform}</option>)}
                </select>
                <Input
                    id="profile-social-url"
                    name="socialUrl"
                    type="url"
                    pattern="https?://.*"
                    maxLength={PROFILE_LIMITS.websiteMax}
                    placeholder="https://"
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    className="flex-1"
                />
                <Button type="button" onClick={handleAdd} disabled={!canAddSocialLink}>Add</Button>
            </div>
        </div>
    );
}
