"use client";

import { useState } from "react";
import Image from "next/image";
import { Loader2, Camera, Plus, X, Trash2, CheckCircle2, AlertTriangle, Briefcase, Calendar, Link as LinkIcon, Code, Github } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { createProfileImageUploadUrlAction, finalizeProfileImageUploadAction } from "@/app/actions/profile";
import { useToast } from "@/components/ui-custom/Toast";
import Input from "@/components/ui-custom/Input";
import { Label } from "@/components/ui-custom/Label";
import Button from "@/components/ui-custom/Button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { sanitizeUsernameInput } from "@/lib/validations/username";
import { useUsernameAvailability } from "@/hooks/useUsernameAvailability";
import { PROFILE_LIMITS } from "@/lib/validations/profile";
import { uploadToSupabaseSignedUrl } from "@/lib/upload/supabase-signed-upload-client";

export type EditProfileSection = "general" | "experience" | "education" | "skills" | "social";

interface EditProfileTabsProps {
    profile: any;
    originalUsername: string;
    section: EditProfileSection;
    onSectionChange: (section: EditProfileSection) => void;
    onChange: (updates: any) => void;
    projects?: any[];
}

export function EditProfileTabs({
    profile,
    originalUsername,
    section,
    onSectionChange,
    onChange,
    projects = [],
}: EditProfileTabsProps) {
    const { showToast } = useToast();
    const [avatarUploading, setAvatarUploading] = useState(false);
    const [bannerUploading, setBannerUploading] = useState(false);

    const { status: usernameStatus, message: usernameMessage } = useUsernameAvailability({
        value: profile.username,
        currentUsername: originalUsername,
        debounceMs: 500,
    });

    const updateForm = (key: string, value: any) => {
        onChange({ ...profile, [key]: value });
    };

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: "avatar" | "banner") => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (type === "avatar") {
            setAvatarUploading(true);
        } else {
            setBannerUploading(true);
        }

        try {
            const uploadSession = await createProfileImageUploadUrlAction({
                mimeType: file.type || "application/octet-stream",
                sizeBytes: file.size,
                kind: type,
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
            updateForm(type === "avatar" ? "avatarUrl" : "bannerUrl", cacheBustedUrl);
            showToast(`${type === "avatar" ? "Avatar" : "Banner"} updated`, "success");
        } catch (error: any) {
            const message = error?.message || "Unknown error";
            showToast(`Failed to upload ${type}: ${message}`, "error");
        } finally {
            if (type === "avatar") {
                setAvatarUploading(false);
            } else {
                setBannerUploading(false);
            }
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
                                            <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(e, "avatar")} disabled={avatarUploading} />
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
                                        <Label htmlFor="profile-full-name">Full Name</Label>
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
                                        <Label htmlFor="profile-username">Username</Label>
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
                                                    usernameStatus === "invalid" && "border-red-500 focus:ring-red-500",
                                                    usernameStatus === "valid" && "border-green-500 focus:ring-green-500",
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
                                    <Label htmlFor="profile-headline">Headline</Label>
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
                                    <Label htmlFor="profile-bio">Bio</Label>
                                        <textarea
                                            id="profile-bio"
                                            name="bio"
                                            maxLength={PROFILE_LIMITS.bioMax}
                                            value={profile.bio ?? ""}
                                            onChange={(e) => updateForm("bio", e.target.value)}
                                            className="w-full mt-1.5 min-h-[100px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                                            placeholder="Tell your story..."
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <Label htmlFor="profile-location" className="text-zinc-600 dark:text-zinc-400">Location</Label>
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
                                        <Label htmlFor="profile-website" className="text-zinc-600 dark:text-zinc-400">Website</Label>
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

                                <div>
                                    <Label className="text-zinc-600 dark:text-zinc-400">Availability Status</Label>
                                    <div className="flex flex-wrap gap-2 mt-2">
                                        {["available", "busy", "focusing", "offline"].map((status) => (
                                            <button
                                                key={status}
                                                type="button"
                                                onClick={() => updateForm("availabilityStatus", status)}
                                                className={cn(
                                                    "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                                                    profile.availabilityStatus === status
                                                        ? "bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-900/30 dark:border-indigo-800 dark:text-indigo-300"
                                                        : "bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800",
                                                )}
                                            >
                                                {status.charAt(0).toUpperCase() + status.slice(1)}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="experience" className="space-y-6 mt-0">
                        <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">Project Contributions</h2>
                        <ProjectContributionsList
                            items={profile.experience ?? []}
                            onChange={(items) => updateForm("experience", items)}
                            projects={projects}
                            profile={profile}
                            onTechStackAdd={(tags) => {
                                const newSkills = [...new Set([...(profile.skills || []), ...tags])];
                                updateForm("skills", newSkills);
                            }}
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
                </div>
            </div>
        </Tabs>
    );
}

function ProjectContributionsList({ items, onChange, projects = [], profile, onTechStackAdd }: { items: any[]; onChange: (items: any[]) => void; projects?: any[]; profile?: any; onTechStackAdd?: (tags: string[]) => void }) {
    const handleAdd = (isPlatform: boolean) => {
        onChange([...items, {
            id: crypto.randomUUID(),
            company: "",
            title: "",
            startDate: "",
            endDate: "",
            projectUrl: "",
            repoUrl: "",
            techTags: "",
            description: "",
            currentlyActive: false,
            isPlatform
        }]);
    };

    const updateItem = (index: number, updates: any) => {
        const next = [...items];
        next[index] = { ...next[index], ...updates };
        
        // If updating tech tags, we can extract them
        if (updates.techTags && typeof updates.techTags === 'string') {
            const parsedTags = updates.techTags.split(",").map((s: string) => s.trim()).filter(Boolean);
            if (parsedTags.length > 0 && onTechStackAdd) {
                onTechStackAdd(parsedTags);
            }
        }
        
        onChange(next);
    };

    const handleDelete = (index: number) => {
        const next = [...items];
        next.splice(index, 1);
        onChange(next);
    };

    return (
        <div className="space-y-10">
            <div className="flex justify-between items-center">
                <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Your Contributions</h3>
                <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => handleAdd(true)}>
                        <Plus className="w-4 h-4 mr-1" /> Add Platform Project
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => handleAdd(false)}>
                        Add External Project
                    </Button>
                </div>
            </div>

            <div className="space-y-12">
                {items.map((item, index) => {
                    const checkboxId = `experience-current-${item.id || index}`;
                    
                    return (
                        <div key={item.id || index} className="space-y-5 relative">
                            <div className="flex justify-between items-center pb-2 border-b border-zinc-200 dark:border-zinc-800">
                                <h4 className="font-semibold text-zinc-900 dark:text-white">Project {index + 1}</h4>
                                <Button type="button" variant="ghost" size="sm" onClick={() => handleDelete(index)} className="text-zinc-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 h-8 px-2">
                                    <Trash2 className="w-4 h-4 mr-1.5" /> Remove
                                </Button>
                            </div>

                            {item.isPlatform && (
                                <div className="bg-indigo-50/50 dark:bg-indigo-900/10 p-4 rounded-xl border border-indigo-100 dark:border-indigo-800/30">
                                    <Label htmlFor={`proj-select-${index}`} className="text-indigo-700 dark:text-indigo-300 flex items-center gap-2 mb-2 font-semibold">
                                        <Briefcase className="w-4 h-4" />
                                        Link an Existing Platform Project
                                    </Label>
                                    <select
                                        id={`proj-select-${index}`}
                                        className="w-full h-11 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"
                                        value={item.projectId || ""}
                                        onChange={(e) => {
                                            const pid = e.target.value;
                                            if (!pid) {
                                                updateItem(index, { projectId: "" });
                                                return;
                                            }
                                            const proj = projects?.find(p => p.id === pid);
                                            if (proj) {
                                                let startDateStr = "";
                                                if (proj.joinedAt) {
                                                    const d = new Date(proj.joinedAt);
                                                    startDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                                                } else if (proj.createdAt) {
                                                    const d = new Date(proj.createdAt);
                                                    startDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                                                }
                                                updateItem(index, {
                                                    projectId: proj.id,
                                                    company: proj.title || "",
                                                    title: proj.userRole || "Contributor",
                                                    startDate: startDateStr,
                                                    projectUrl: proj.url || "",
                                                    repoUrl: "",
                                                    techTags: (proj.skills || []).join(", "),
                                                });
                                            }
                                        }}
                                    >
                                        <option value="">-- Choose a project --</option>
                                        {projects?.map(p => (
                                            <option key={p.id} value={p.id}>{p.title}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <Label htmlFor={`org-${index}`} className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
                                        <Briefcase className="w-3.5 h-3.5" /> Project Name
                                    </Label>
                                    <Input
                                        id={`org-${index}`}
                                        maxLength={80}
                                        value={item.company || ""}
                                        onChange={(e) => updateItem(index, { company: e.target.value })}
                                        className="mt-1.5 bg-zinc-50 dark:bg-zinc-900 focus:bg-white dark:focus:bg-zinc-950 transition-colors h-10"
                                        placeholder="e.g. Supabase, Vercel"
                                    />
                                </div>
                                <div>
                                    <Label htmlFor={`role-${index}`} className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
                                        <Code className="w-3.5 h-3.5" /> Your Role
                                    </Label>
                                    <Input
                                        id={`role-${index}`}
                                        maxLength={80}
                                        value={item.title || ""}
                                        onChange={(e) => updateItem(index, { title: e.target.value })}
                                        className="mt-1.5 bg-zinc-50 dark:bg-zinc-900 focus:bg-white dark:focus:bg-zinc-950 transition-colors h-10"
                                        placeholder="e.g. Core Maintainer, Creator"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <Label htmlFor={`start-date-${index}`} className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
                                        <Calendar className="w-3.5 h-3.5" /> Start Date
                                    </Label>
                                    <Input
                                        id={`start-date-${index}`}
                                        type="date"
                                        value={item.startDate || ""}
                                        onChange={(e) => updateItem(index, { startDate: e.target.value })}
                                        className="mt-1.5 bg-zinc-50 dark:bg-zinc-900 focus:bg-white dark:focus:bg-zinc-950 transition-colors h-10 text-zinc-900 dark:text-zinc-100"
                                    />
                                </div>
                                <div>
                                    <Label htmlFor={`end-date-${index}`} className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
                                        <Calendar className="w-3.5 h-3.5" /> End Date
                                    </Label>
                                    <div className="relative mt-1.5">
                                        <Input
                                            id={`end-date-${index}`}
                                            type={item.currentlyActive ? "text" : "date"}
                                            disabled={Boolean(item.currentlyActive)}
                                            value={item.currentlyActive ? "Present" : (item.endDate || "")}
                                            onChange={(e) => updateItem(index, { endDate: e.target.value })}
                                            className={item.currentlyActive ? "h-10 text-emerald-600 font-medium bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800" : "h-10 bg-zinc-50 dark:bg-zinc-900 focus:bg-white dark:focus:bg-zinc-950 transition-colors text-zinc-900 dark:text-zinc-100"}
                                        />
                                    </div>
                                    <div className="flex items-center gap-2 mt-2 ml-1">
                                        <input
                                            type="checkbox"
                                            id={checkboxId}
                                            checked={Boolean(item.currentlyActive)}
                                            onChange={(e) => updateItem(index, {
                                                currentlyActive: e.target.checked,
                                                endDate: e.target.checked ? "" : item.endDate || "",
                                            })}
                                            className="w-4 h-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                                        />
                                        <label htmlFor={checkboxId} className="text-xs font-medium text-zinc-600 dark:text-zinc-400 cursor-pointer">
                                            I am currently working on this
                                        </label>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <Label htmlFor={`proj-url-${index}`} className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
                                        <LinkIcon className="w-3.5 h-3.5" /> Project URL
                                    </Label>
                                    <Input
                                        id={`proj-url-${index}`}
                                        type={item.projectId ? "text" : "url"}
                                        readOnly={!!item.projectId}
                                        disabled={!!item.projectId}
                                        value={item.projectUrl || ""}
                                        onChange={(e) => updateItem(index, { projectUrl: e.target.value })}
                                        className="mt-1.5 bg-zinc-50 dark:bg-zinc-900 focus:bg-white dark:focus:bg-zinc-950 transition-colors h-10 disabled:opacity-70 disabled:bg-zinc-100 dark:disabled:bg-zinc-800/50"
                                        placeholder="https://"
                                    />
                                </div>
                                <div>
                                    <Label htmlFor={`repo-url-${index}`} className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
                                        <Github className="w-3.5 h-3.5" /> Repository URL
                                    </Label>
                                    <Input
                                        id={`repo-url-${index}`}
                                        type="url"
                                        value={item.repoUrl || ""}
                                        onChange={(e) => updateItem(index, { repoUrl: e.target.value })}
                                        className="mt-1.5 bg-zinc-50 dark:bg-zinc-900 focus:bg-white dark:focus:bg-zinc-950 transition-colors h-10"
                                        placeholder="https://github.com/..."
                                    />
                                </div>
                            </div>

                            <div>
                                <Label htmlFor={`tech-tags-${index}`} className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
                                    <Code className="w-3.5 h-3.5" /> Tech Stack
                                </Label>
                                <Input
                                    id={`tech-tags-${index}`}
                                    value={typeof item.techTags === 'string' ? item.techTags : (item.techTags || []).join(', ')}
                                    onChange={(e) => updateItem(index, { techTags: e.target.value })}
                                    className="mt-1.5 bg-zinc-50 dark:bg-zinc-900 focus:bg-white dark:focus:bg-zinc-950 transition-colors h-10"
                                    placeholder="React, TypeScript, Tailwind"
                                />
                                <p className="text-[11px] text-zinc-400 mt-1 ml-1">Comma separated</p>
                            </div>

                            <div>
                                <Label htmlFor={`description-${index}`} className="text-zinc-600 dark:text-zinc-400">Description</Label>
                                <textarea
                                    id={`description-${index}`}
                                    maxLength={500}
                                    className="w-full mt-1.5 min-h-[80px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 focus:bg-white dark:focus:bg-zinc-950 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition-all resize-none"
                                    value={item.description || ""}
                                    onChange={(e) => updateItem(index, { description: e.target.value })}
                                    placeholder="Briefly describe your contributions..."
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function SkillsEditor({ skills, onChange }: { skills: string[]; onChange: (skills: string[]) => void }) {
    const [input, setInput] = useState("");

    const handleAdd = (event?: React.FormEvent) => {
        event?.preventDefault();
        const value = input.trim();
        if (!value || skills.includes(value)) return;
        onChange([...skills, value]);
        setInput("");
    };

    const remove = (skill: string) => onChange(skills.filter((entry) => entry !== skill));

    return (
        <div className="space-y-4">
            <Label htmlFor="profile-skill-input">Skills & Expertise</Label>
            <div className="flex flex-wrap gap-2 min-h-[40px]">
                {skills.map((skill) => (
                    <span key={skill} className="inline-flex items-center px-3 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-sm text-zinc-700 dark:text-zinc-300">
                        {skill}
                        <button type="button" onClick={() => remove(skill)} className="ml-2 hover:text-red-500"><X className="w-3 h-3" /></button>
                    </span>
                ))}
            </div>
            <div className="flex gap-2">
                <Input
                    id="profile-skill-input"
                    name="skill"
                    maxLength={PROFILE_LIMITS.listItemMax}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") {
                            event.preventDefault();
                            handleAdd();
                        }
                    }}
                    placeholder="Add a skill (e.g. React, Design)..."
                />
                <Button type="button" onClick={() => handleAdd()} disabled={!input.trim()}>Add</Button>
            </div>
        </div>
    );
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
