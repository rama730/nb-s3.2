"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { Loader2, Camera, Plus, X, Trash2, Calendar, GripVertical, CheckCircle2, AlertTriangle } from "lucide-react";
import { createProfileImageUploadUrlAction } from "@/app/actions/profile";
import { useToast } from "@/components/ui-custom/Toast";
import Input from "@/components/ui-custom/Input";
import { Label } from "@/components/ui-custom/Label";
import Button from "@/components/ui-custom/Button";
import { checkUsernameAvailability } from "@/app/actions/onboarding";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface EditProfileTabsProps {
    profile: any;
    onChange: (updates: any) => void;
}

export function EditProfileTabs({ profile, onChange }: EditProfileTabsProps) {
    const { showToast } = useToast();

    // -- STATES --
    // General
    const [avatarUploading, setAvatarUploading] = useState(false);
    const [bannerUploading, setBannerUploading] = useState(false);

    // Username Check
    const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'error'>('idle');
    const [usernameMessage, setUsernameMessage] = useState('');
    const usernameDebounceRef = useRef<NodeJS.Timeout>(null);

    // Initial state matching profile
    const [formData, setFormData] = useState({
        // General
        full_name: profile.fullName || profile.full_name || "",
        username: profile.username || "",
        headline: profile.headline || "",
        bio: profile.bio || "",
        location: profile.location || "",
        website: profile.website || "",
        avatar_url: profile.avatarUrl || profile.avatar_url || "",
        banner_url: profile.bannerUrl || profile.banner_url || "",
        availabilityStatus: profile.availabilityStatus || profile.availability_status || "available",
        openTo: profile.openTo || profile.open_to || [],

        // Detailed
        skills: profile.skills || [],
        socialLinks: profile.socialLinks || profile.social_links || {},
        experience: profile.experience || [],
        education: profile.education || [],
    });

    // Use useEffect to bubble up changes to parent to avoid "setState during render" error
    // Debounce this if needed, but for now specific updates are fine.
    // However, the original error was likely due to immediate calls.
    // We will keep local state and only call onChange when fields actually change.

    // Actually, a better approach for the form is:
    // 1. Local state drives the UI.
    // 2. We call onChange only in the event handlers, but ensuring we don't trigger re-renders of parent that loop back immediately if strict equality fails.
    // The previous updateForm was:
    // setFormData -> onChange(next).
    // If onChange(next) causes Parent to re-render -> passing new 'profile' prop -> re-initializing EditProfileTabs state? NO.
    // We only initialize state once.
    // The error "Cannot update a component (`EditProfileModal`) while rendering a different component (`EditProfileTabs`)"
    // usually happens if we call the function directly in the render body or inside a UseEffect that fires immediately.

    // Let's modify updateForm to be safe.
    // And remove Banner UI.

    const updateForm = (key: string, value: any) => {
        const next = { ...formData, [key]: value };
        setFormData(next);
        // Defer the parent update to avoid the render-phase warning if it was happening there
        // But purely event-driven updates shouldn't cause this unless the event handler is firing unexpectedly.
        // We'll wrap in requestAnimationFrame or just ensure it's event bound.
        onChange(next);
    };

    // -- AVATAR UPLOAD --
    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'avatar' | 'banner') => {
        const file = e.target.files?.[0];
        if (!file) return;

        const setUploading = type === 'avatar' ? setAvatarUploading : setBannerUploading;
        setUploading(true);

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
            const key = type === 'avatar' ? 'avatar_url' : 'banner_url';
            updateForm(key, cacheBustedUrl);
            showToast(`${type === 'avatar' ? 'Avatar' : 'Banner'} updated`, "success");
        } catch (error: any) {
            console.error("[Upload] Error uploading asset", { type, error });
            const message = error?.message || error?.error_description || 'Unknown error';
            showToast(`Failed to upload ${type}: ${message}`, "error");
        } finally {
            setUploading(false);
        }
    };

    // -- USERNAME CHECK --
    const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''); // Enforce basics immediately
        updateForm('username', val);

        if (val === profile.username) {
            setUsernameStatus('idle');
            setUsernameMessage('');
            return;
        }

        setUsernameStatus('checking');
        if (usernameDebounceRef.current) clearTimeout(usernameDebounceRef.current);

        usernameDebounceRef.current = setTimeout(async () => {
            if (val.length < 3) {
                setUsernameStatus('error');
                setUsernameMessage('Too short');
                return;
            }
            const res = await checkUsernameAvailability(val);
            if (res.available) {
                setUsernameStatus('available');
                setUsernameMessage('Available');
            } else {
                setUsernameStatus('taken');
                setUsernameMessage(res.message);
            }
        }, 500);
    };

    // -- ARRAYS (Experience/Education) --
    // We'll use a simple "Edit Item" state to show a form modal or inline form. 
    // For simplicity: Inline expansion or simple list addition.
    // Let's do a simple "Append" form at the bottom of the list.

    return (
        <Tabs defaultValue="general" className="w-full h-full flex flex-col md:flex-row" orientation="vertical">
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

                {/* --- GENERAL TAB --- */}
                <TabsContent value="general" className="space-y-4 mt-0">
                    {/* Images */}
                    <div className="space-y-4">
                        {/* Banner Removed as per request */}

                        {/* Avatar - Prominent Layout */}
                        <div className="flex flex-col items-center sm:items-start pb-4">
                            <h2 className="text-xl font-semibold text-zinc-900 dark:text-white mb-6">General Properties</h2>
                            <div className="flex items-center gap-5 relative z-10 w-full">
                            <div className="w-20 h-20 rounded-2xl bg-zinc-200 dark:bg-zinc-800 border-4 border-white dark:border-zinc-900 overflow-hidden relative group shrink-0">
                                {formData.avatar_url ? (
                                    <Image
                                        src={formData.avatar_url}
                                        alt="Avatar"
                                        fill
                                        className="object-cover"
                                        sizes="80px"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-zinc-400">
                                        {(formData.full_name?.[0] || formData.username?.[0] || "?").toUpperCase()}
                                    </div>
                                )}
                                <label className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center cursor-pointer transition-opacity text-white">
                                    {avatarUploading ? <Loader2 className="w-6 h-6 animate-spin mb-1" /> : <Camera className="w-6 h-6 mb-1" />}
                                    <span className="text-xs font-medium">{avatarUploading ? 'Uploading...' : 'Change'}</span>
                                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(e, 'avatar')} disabled={avatarUploading} />
                                </label>
                            </div>
                            <div className="flex flex-col">
                                <h3 className="font-semibold text-base">Profile Photo</h3>
                                <p className="text-sm text-zinc-500 mt-1">Recommended size: 400x400px. <br className="hidden sm:block"/>Max 5MB.</p>
                            </div>
                        </div>
                    </div>
                </div>

                    {/* Basic Info */}
                    <div className="grid gap-6">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label>Full Name</Label>
                                <Input
                                    value={formData.full_name}
                                    onChange={(e) => updateForm('full_name', e.target.value)}
                                    className="mt-1.5"
                                />
                            </div>
                            <div>
                                <Label>Username</Label>
                                <div className="relative mt-1.5">
                                    <Input
                                        value={formData.username}
                                        onChange={handleUsernameChange}
                                        className={cn(
                                            usernameStatus === 'taken' && "border-red-500 focus:ring-red-500",
                                            usernameStatus === 'available' && "border-green-500 focus:ring-green-500",
                                            formData.username === profile.username && "pr-10"
                                        )}
                                    />
                                    {/* Status Overlay for Current Username */}
                                    {formData.username === profile.username && (
                                        <div className="absolute right-3 top-2.5 flex items-center gap-1.5 text-emerald-600 dark:text-emerald-500 bg-emerald-50/50 dark:bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-100/50 dark:border-emerald-500/20">
                                            <CheckCircle2 className="w-3.5 h-3.5" />
                                            <span className="text-[10px] font-bold uppercase tracking-wider">Secured</span>
                                        </div>
                                    )}
                                    
                                    {usernameStatus === 'checking' && <Loader2 className="absolute right-3 top-2.5 w-4 h-4 animate-spin text-zinc-400" />}
                                </div>
                                
                                {/* Availability / Error Message */}
                                {usernameMessage && formData.username !== profile.username && (
                                    <p className={cn("text-xs mt-2 font-medium flex items-center gap-1.5",
                                        usernameStatus === 'available' ? "text-emerald-600 dark:text-emerald-500" : "text-red-500"
                                    )}>
                                        {usernameStatus === 'available' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                                        {usernameMessage}
                                    </p>
                                )}

                                {/* Prominent Change Warning */}
                                {formData.username !== profile.username && formData.username.length > 0 && (
                                    <div className="mt-3 flex items-start gap-3 rounded-2xl border border-amber-200/50 bg-amber-50/50 dark:border-amber-900/30 dark:bg-amber-900/20 p-4 text-[13px] text-amber-900 dark:text-amber-200 shadow-sm animate-in fade-in slide-in-from-top-1">
                                        <div className="mt-0.5 bg-amber-100 dark:bg-amber-900/50 p-1 rounded-lg">
                                            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                                        </div>
                                        <div className="space-y-1">
                                            <p className="font-semibold">Changing your identity</p>
                                            <p className="leading-relaxed opacity-80 text-xs">This will update your profile URL and break existing mentions/links across the network. Changes to usernames are strictly regulated.</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div>
                            <Label>Headline</Label>
                            <Input
                                value={formData.headline}
                                onChange={(e) => updateForm('headline', e.target.value)}
                                placeholder="e.g. Senior Frontend Engineer"
                                className="mt-1.5"
                            />
                        </div>

                        <div>
                            <Label>Bio</Label>
                            <textarea
                                value={formData.bio}
                                onChange={(e) => updateForm('bio', e.target.value)}
                                className="w-full mt-1.5 min-h-[100px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                                placeholder="Tell your story..."
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label className="text-zinc-600 dark:text-zinc-400">Location</Label>
                                <Input
                                    value={formData.location}
                                    onChange={(e) => updateForm('location', e.target.value)}
                                    placeholder="City, Country"
                                    className="mt-1.5"
                                />
                            </div>
                            <div>
                                <Label className="text-zinc-600 dark:text-zinc-400">Website</Label>
                                <Input
                                    value={formData.website}
                                    onChange={(e) => updateForm('website', e.target.value)}
                                    placeholder="https://"
                                    className="mt-1.5"
                                />
                            </div>
                        </div>

                        <div>
                            <Label className="text-zinc-600 dark:text-zinc-400">Availability Status</Label>
                            <div className="flex flex-wrap gap-2 mt-2">
                                {['available', 'busy', 'focusing', 'offline'].map((status) => (
                                    <button
                                        key={status}
                                        type="button"
                                        onClick={() => updateForm('availabilityStatus', status)}
                                        className={cn(
                                            "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                                            formData.availabilityStatus === status
                                                ? "bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-900/30 dark:border-indigo-800 dark:text-indigo-300"
                                                : "bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800"
                                        )}
                                    >
                                        {status.charAt(0).toUpperCase() + status.slice(1)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </TabsContent>

                {/* --- EXPERIENCE TAB --- */}
                <TabsContent value="experience" className="space-y-6 mt-0">
                    <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">Work Experience</h2>
                    <HistoryList
                        items={formData.experience}
                        onChange={(items) => updateForm('experience', items)}
                        type="experience"
                    />
                </TabsContent>

                {/* --- EDUCATION TAB --- */}
                <TabsContent value="education" className="space-y-6 mt-0">
                    <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">Education History</h2>
                    <HistoryList
                        items={formData.education}
                        onChange={(items) => updateForm('education', items)}
                        type="education"
                    />
                </TabsContent>

                {/* --- SKILLS TAB --- */}
                <TabsContent value="skills" className="space-y-6 mt-0">
                    <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">Skills & Expertise</h2>
                    <SkillsEditor
                        skills={formData.skills}
                        onChange={(skills) => updateForm('skills', skills)}
                    />
                </TabsContent>

                {/* --- SOCIAL TAB --- */}
                <TabsContent value="social" className="space-y-6 mt-0">
                    <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">Social Presence</h2>
                    <SocialLinksEditor
                        links={formData.socialLinks}
                        onChange={(links) => updateForm('socialLinks', links)}
                    />
                </TabsContent>
                </div>
            </div>
        </Tabs>
    );
}

// --- SUB COMPONENTS ---

function HistoryList({ items, onChange, type }: { items: any[], onChange: (items: any[]) => void, type: 'experience' | 'education' }) {
    const isEdu = type === 'education';
    const [isAdding, setIsAdding] = useState(false);

    // Add Form State
    const [newItem, setNewItem] = useState<any>({});

    const handleAdd = () => {
        if (!newItem.title && !newItem.school) return;
        onChange([...items, { ...newItem, id: crypto.randomUUID() }]);
        setNewItem({});
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
                <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{isEdu ? "Education" : "Work Experience"}</h3>
                <Button variant="outline" size="sm" onClick={() => setIsAdding(true)} disabled={isAdding}>
                    <Plus className="w-4 h-4 mr-1" /> Add
                </Button>
            </div>

            <div className="space-y-3">
                {items.map((item, i) => (
                    <div key={i} className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex justify-between items-start group">
                        <div>
                            <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">{item.title || item.degree || "Untitled"}</div>
                            <div className="text-xs text-zinc-500">{item.company || item.school}</div>
                            <div className="text-xs text-zinc-400 mt-1">{item.startDate} — {item.endDate || "Present"}</div>
                        </div>
                        <button onClick={() => handleDelete(i)} className="text-zinc-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1">
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                ))}
            </div>

            {isAdding && (
                <div className="p-4 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <Label>{isEdu ? "School / University" : "Company"}</Label>
                            <Input
                                value={newItem[isEdu ? 'school' : 'company'] || ''}
                                onChange={e => setNewItem({ ...newItem, [isEdu ? 'school' : 'company']: e.target.value })}
                                className="mt-1"
                            />
                        </div>
                        <div>
                            <Label>{isEdu ? "Degree / Field" : "Job Title"}</Label>
                            <Input
                                value={newItem[isEdu ? 'degree' : 'title'] || ''}
                                onChange={e => setNewItem({ ...newItem, [isEdu ? 'degree' : 'title']: e.target.value })}
                                className="mt-1"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <Label>Start Date</Label>
                            <Input
                                type="month"
                                value={newItem.startDate || ''}
                                onChange={e => setNewItem({ ...newItem, startDate: e.target.value })}
                                className="mt-1"
                            />
                        </div>
                        <div>
                            <Label>End Date</Label>
                            <Input
                                type="month"
                                value={newItem.endDate || ''}
                                onChange={e => setNewItem({ ...newItem, endDate: e.target.value })}
                                className="mt-1"
                            />
                            <div className="flex items-center gap-2 mt-1">
                                <input
                                    type="checkbox"
                                    id="current"
                                    checked={!newItem.endDate}
                                    onChange={e => setNewItem({ ...newItem, endDate: e.target.checked ? '' : newItem.endDate })}
                                />
                                <label htmlFor="current" className="text-xs text-zinc-500">I currently work here</label>
                            </div>
                        </div>
                    </div>
                    <div>
                        <Label>Description</Label>
                        <textarea
                            className="w-full mt-1 min-h-[60px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-2 text-sm outline-none"
                            value={newItem.description || ''}
                            onChange={e => setNewItem({ ...newItem, description: e.target.value })}
                        />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="ghost" size="sm" onClick={() => setIsAdding(false)}>Cancel</Button>
                        <Button size="sm" onClick={handleAdd}>Add Item</Button>
                    </div>
                </div>
            )}
        </div>
    )
}

function SkillsEditor({ skills, onChange }: { skills: string[], onChange: (s: string[]) => void }) {
    const [input, setInput] = useState('');
    const handleAdd = (e?: React.FormEvent) => {
        e?.preventDefault();
        const val = input.trim();
        if (!val || skills.includes(val)) return;
        onChange([...skills, val]);
        setInput('');
    };
    const remove = (skill: string) => onChange(skills.filter(s => s !== skill));

    return (
        <div className="space-y-4">
            <Label>Skills & Expertise</Label>
            <div className="flex flex-wrap gap-2 min-h-[40px]">
                {skills.map(skill => (
                    <span key={skill} className="inline-flex items-center px-3 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-sm text-zinc-700 dark:text-zinc-300">
                        {skill}
                        <button onClick={() => remove(skill)} className="ml-2 hover:text-red-500"><X className="w-3 h-3" /></button>
                    </span>
                ))}
            </div>
            <form onSubmit={handleAdd} className="flex gap-2">
                <Input
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder="Add a skill (e.g. React, Design)..."
                />
                <Button type="submit" disabled={!input.trim()}>Add</Button>
            </form>
        </div>
    )
}

function SocialLinksEditor({ links, onChange }: { links: Record<string, string>, onChange: (l: Record<string, string>) => void }) {
    // Convert object to array for editing
    const entries = Object.entries(links);

    // Platforms list
    const platforms = ['Twitter', 'GitHub', 'LinkedIn', 'Instagram', 'Website', 'Portfolio', 'Other'];
    const [newPlatform, setNewPlatform] = useState(platforms[0]);
    const [newUrl, setNewUrl] = useState('');

    const handleAdd = () => {
        if (!newUrl) return;
        onChange({ ...links, [newPlatform.toLowerCase()]: newUrl });
        setNewUrl('');
    };

    const remove = (key: string) => {
        const next = { ...links };
        delete next[key];
        onChange(next);
    }

    return (
        <div className="space-y-4">
            <div className="space-y-3">
                {entries.map(([key, url]) => (
                    <div key={key} className="flex items-center gap-2">
                        <div className="w-24 shrink-0 text-sm font-medium capitalize text-zinc-700 dark:text-zinc-300">{key}</div>
                        <Input value={url} readOnly className="flex-1 bg-zinc-50 dark:bg-zinc-900/50" />
                        <Button variant="ghost" size="sm" onClick={() => remove(key)} className="px-2"><Trash2 className="w-4 h-4 text-zinc-400" /></Button>
                    </div>
                ))}
            </div>

            <div className="flex gap-2 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                <select
                    value={newPlatform}
                    onChange={e => setNewPlatform(e.target.value)}
                    className="h-10 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 text-sm outline-none"
                >
                    {platforms.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <Input
                    placeholder="URL..."
                    value={newUrl}
                    onChange={e => setNewUrl(e.target.value)}
                    className="flex-1"
                />
                <Button onClick={handleAdd} disabled={!newUrl}>Add</Button>
            </div>
        </div>
    )
}
