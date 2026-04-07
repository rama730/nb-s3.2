"use client";

import { useState } from "react";
import Image from "next/image";
import { Loader2, Camera, Plus, X, Trash2, CheckCircle2, AlertTriangle } from "lucide-react";
import { createProfileImageUploadUrlAction } from "@/app/actions/profile";
import { useToast } from "@/components/ui-custom/Toast";
import Input from "@/components/ui-custom/Input";
import { Label } from "@/components/ui-custom/Label";
import Button from "@/components/ui-custom/Button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { sanitizeUsernameInput } from "@/lib/validations/username";
import { useUsernameAvailability } from "@/hooks/useUsernameAvailability";
import { PROFILE_LIMITS } from "@/lib/validations/profile";

export type EditProfileSection = "general" | "experience" | "education" | "skills" | "social";

interface EditProfileTabsProps {
    profile: any;
    originalUsername: string;
    section: EditProfileSection;
    onSectionChange: (section: EditProfileSection) => void;
    onChange: (updates: any) => void;
}

export function EditProfileTabs({
    profile,
    originalUsername,
    section,
    onSectionChange,
    onChange,
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

            const uploadResponse = await fetch(uploadSession.uploadUrl, {
                method: "PUT",
                headers: { "Content-Type": uploadSession.contentType },
                body: file,
            });
            if (!uploadResponse.ok) {
                throw new Error(`Failed to upload image (${uploadResponse.status})`);
            }

            const cacheBustedUrl = `${uploadSession.publicUrl}?t=${Date.now()}`;
            updateForm(type === "avatar" ? "avatar_url" : "banner_url", cacheBustedUrl);
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
                        Work Experience
                    </TabsTrigger>
                    <TabsTrigger value="education" className="w-full justify-start px-3 py-2 text-sm font-medium data-[state=active]:bg-zinc-100 dark:data-[state=active]:bg-zinc-800 data-[state=active]:shadow-none rounded-lg text-zinc-600 data-[state=active]:text-zinc-900 dark:text-zinc-400 dark:data-[state=active]:text-zinc-100">
                        Education History
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
                                        {profile.avatar_url ? (
                                            <Image src={profile.avatar_url} alt="Profile avatar" fill className="object-cover" sizes="80px" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-zinc-400">
                                                {(profile.full_name?.[0] || profile.username?.[0] || "?").toUpperCase()}
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
                                            name="full_name"
                                            required
                                            minLength={1}
                                            maxLength={PROFILE_LIMITS.fullNameMax}
                                            value={profile.full_name ?? ""}
                                            onChange={(e) => updateForm("full_name", e.target.value)}
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
                        <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">Work Experience</h2>
                        <HistoryList
                            items={profile.experience ?? []}
                            onChange={(items) => updateForm("experience", items)}
                            type="experience"
                        />
                    </TabsContent>

                    <TabsContent value="education" className="space-y-6 mt-0">
                        <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">Education History</h2>
                        <HistoryList
                            items={profile.education ?? []}
                            onChange={(items) => updateForm("education", items)}
                            type="education"
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

function HistoryList({ items, onChange, type }: { items: any[]; onChange: (items: any[]) => void; type: "experience" | "education" }) {
    const isEducation = type === "education";
    const [isAdding, setIsAdding] = useState(false);
    const [newItem, setNewItem] = useState<any>({ currentlyActive: false });
    const checkboxId = `${type}-current-${newItem.id || "new"}`;

    const handleAdd = () => {
        const hasRequiredFields = isEducation
            ? Boolean(newItem.school?.trim() || newItem.degree?.trim())
            : Boolean(newItem.title?.trim() || newItem.company?.trim());
        if (!hasRequiredFields) return;
        onChange([...items, {
            ...newItem,
            id: crypto.randomUUID(),
            endDate: newItem.currentlyActive ? "" : newItem.endDate || "",
        }]);
        setNewItem({ currentlyActive: false });
        setIsAdding(false);
    };

    const handleDelete = (index: number) => {
        const next = [...items];
        next.splice(index, 1);
        onChange(next);
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{isEducation ? "Education" : "Work Experience"}</h3>
                <Button type="button" variant="outline" size="sm" onClick={() => setIsAdding(true)} disabled={isAdding}>
                    <Plus className="w-4 h-4 mr-1" /> Add
                </Button>
            </div>

            <div className="space-y-3">
                {items.map((item, index) => (
                    <div key={item.id || index} className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex justify-between items-start group">
                        <div>
                            <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">{item.title || item.degree || "Untitled"}</div>
                            <div className="text-xs text-zinc-500">{item.company || item.school}</div>
                            <div className="text-xs text-zinc-400 mt-1">{item.startDate || "Start"} — {item.endDate || "Present"}</div>
                        </div>
                        <button type="button" onClick={() => handleDelete(index)} className="text-zinc-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1">
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                ))}
            </div>

            {isAdding ? (
                <div className="p-4 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <Label htmlFor={`${type}-org`}>{isEducation ? "School / University" : "Company"}</Label>
                            <Input
                                id={`${type}-org`}
                                name={isEducation ? "school" : "company"}
                                maxLength={80}
                                value={newItem[isEducation ? "school" : "company"] || ""}
                                onChange={(e) => setNewItem({ ...newItem, [isEducation ? "school" : "company"]: e.target.value })}
                                className="mt-1"
                            />
                        </div>
                        <div>
                            <Label htmlFor={`${type}-role`}>{isEducation ? "Degree / Field" : "Job Title"}</Label>
                            <Input
                                id={`${type}-role`}
                                name={isEducation ? "degree" : "title"}
                                maxLength={80}
                                value={newItem[isEducation ? "degree" : "title"] || ""}
                                onChange={(e) => setNewItem({ ...newItem, [isEducation ? "degree" : "title"]: e.target.value })}
                                className="mt-1"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <Label htmlFor={`${type}-start-date`}>Start Date</Label>
                            <Input
                                id={`${type}-start-date`}
                                name="startDate"
                                type="month"
                                value={newItem.startDate || ""}
                                onChange={(e) => setNewItem({ ...newItem, startDate: e.target.value })}
                                className="mt-1"
                            />
                        </div>
                        <div>
                            <Label htmlFor={`${type}-end-date`}>End Date</Label>
                            <Input
                                id={`${type}-end-date`}
                                name="endDate"
                                type="month"
                                disabled={Boolean(newItem.currentlyActive)}
                                aria-disabled={Boolean(newItem.currentlyActive)}
                                value={newItem.endDate || ""}
                                onChange={(e) => setNewItem({ ...newItem, endDate: e.target.value })}
                                className="mt-1"
                            />
                            <div className="flex items-center gap-2 mt-1">
                                <input
                                    type="checkbox"
                                    id={checkboxId}
                                    checked={Boolean(newItem.currentlyActive)}
                                    onChange={(e) => setNewItem({
                                        ...newItem,
                                        currentlyActive: e.target.checked,
                                        endDate: e.target.checked ? "" : newItem.endDate || "",
                                    })}
                                />
                                <label htmlFor={checkboxId} className="text-xs text-zinc-500">
                                    {isEducation ? "I currently study here" : "I currently work here"}
                                </label>
                            </div>
                        </div>
                    </div>
                    <div>
                        <Label htmlFor={`${type}-description`}>Description</Label>
                        <textarea
                            id={`${type}-description`}
                            name="description"
                            maxLength={500}
                            className="w-full mt-1 min-h-[60px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-2 text-sm outline-none"
                            value={newItem.description || ""}
                            onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                        />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button type="button" variant="ghost" size="sm" onClick={() => setIsAdding(false)}>Cancel</Button>
                        <Button type="button" size="sm" onClick={handleAdd}>Add Item</Button>
                    </div>
                </div>
            ) : null}
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
    const [newPlatform, setNewPlatform] = useState(platforms[0]);
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
