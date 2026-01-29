"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { Loader2, Camera, Plus, X, Trash2, Calendar, GripVertical } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
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
    const supabase = createSupabaseBrowserClient();

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
            // 1. Get authenticated user ID reliably from Supabase session
            const { data: { user }, error: authError } = await supabase.auth.getUser();
            if (authError || !user) {
                console.error('Auth error or no user:', authError);
                showToast('Please log in to upload images', 'error');
                return;
            }

            const userId = user.id;

            // 2. Delete old avatar from storage if exists
            const currentUrl = type === 'avatar' ? formData.avatar_url : formData.banner_url;
            if (currentUrl && currentUrl.includes('/avatars/')) {
                try {
                    // Extract file path from URL (format: .../avatars/{userId}/{filename})
                    const urlParts = currentUrl.split('/avatars/');
                    if (urlParts[1]) {
                        const oldFilePath = urlParts[1];

                        const { error: deleteError } = await supabase.storage
                            .from('avatars')
                            .remove([oldFilePath]);
                        if (deleteError) {
                            console.warn('[Upload] Could not delete old file:', deleteError);
                        } else {

                        }
                    }
                } catch (delErr) {
                    console.warn('[Upload] Error deleting old avatar:', delErr);
                    // Continue with upload even if delete fails
                }
            }

            const fileExt = file.name.split(".").pop()?.toLowerCase() || 'jpg';
            const fileName = `${Date.now()}.${fileExt}`;
            const filePath = `${userId}/${fileName}`;



            // 3. Upload to Supabase Storage
            const { data: uploadData, error: uploadError } = await supabase.storage
                .from("avatars")
                .upload(filePath, file, {
                    upsert: true,
                    cacheControl: '0',  // No caching for avatars
                    contentType: file.type
                });

            if (uploadError) {
                console.error('[Upload] Upload error:', uploadError);
                throw uploadError;
            }



            // 4. Get the public URL with cache buster
            const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(filePath);
            // Add timestamp to bust any CDN/browser cache
            const cacheBustedUrl = `${publicUrl}?t=${Date.now()}`;


            // 5. Update the form state
            const key = type === 'avatar' ? 'avatar_url' : 'banner_url';
            updateForm(key, cacheBustedUrl);
            showToast(`${type === 'avatar' ? 'Avatar' : 'Banner'} updated`, "success");
        } catch (error: any) {
            console.error(`[Upload] Error uploading ${type}:`, error);
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
        <Tabs defaultValue="general" className="w-full h-full flex flex-col">
            <div className="px-5 pt-3">
                <TabsList className="grid w-full grid-cols-5 h-9 py-0.5">
                    <TabsTrigger value="general" className="text-xs sm:text-sm">General</TabsTrigger>
                    <TabsTrigger value="experience" className="text-xs sm:text-sm">Exp</TabsTrigger>
                    <TabsTrigger value="education" className="text-xs sm:text-sm">Edu</TabsTrigger>
                    <TabsTrigger value="skills" className="text-xs sm:text-sm">Skills</TabsTrigger>
                    <TabsTrigger value="social" className="text-xs sm:text-sm">Social</TabsTrigger>
                </TabsList>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 pb-6 custom-scrollbar">

                {/* --- GENERAL TAB --- */}
                <TabsContent value="general" className="space-y-4 mt-0">
                    {/* Images */}
                    <div className="space-y-4">
                        {/* Banner Removed as per request */}

                        {/* Avatar - Compact Layout */}
                        <div className="flex items-center gap-4 pl-0 relative z-10">
                            <div className="w-20 h-20 rounded-2xl bg-zinc-200 dark:bg-zinc-800 border-4 border-white dark:border-zinc-900 overflow-hidden relative group shrink-0">
                                {formData.avatar_url ? (
                                    <Image src={formData.avatar_url} alt="Avatar" fill className="object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-zinc-400">
                                        {(formData.full_name?.[0] || formData.username?.[0] || "?").toUpperCase()}
                                    </div>
                                )}
                                <label className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center cursor-pointer transition-opacity">
                                    {avatarUploading ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <Camera className="w-4 h-4 text-white" />}
                                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(e, 'avatar')} disabled={avatarUploading} />
                                </label>
                            </div>
                            <div className="flex flex-col">
                                <h3 className="font-semibold text-base">Profile Photo</h3>
                                <p className="text-xs text-zinc-500">Recommended 400x400px</p>
                            </div>
                        </div>
                    </div>

                    {/* Basic Info */}
                    <div className="grid gap-4">
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
                                            usernameStatus === 'available' && "border-green-500 focus:ring-green-500"
                                        )}
                                    />
                                    {usernameStatus === 'checking' && <Loader2 className="absolute right-3 top-2.5 w-4 h-4 animate-spin text-zinc-400" />}
                                </div>
                                {usernameMessage && (
                                    <p className={cn("text-xs mt-1",
                                        usernameStatus === 'available' ? "text-green-600" : "text-red-500"
                                    )}>
                                        {usernameMessage}
                                    </p>
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
                                <Label>Location</Label>
                                <Input
                                    value={formData.location}
                                    onChange={(e) => updateForm('location', e.target.value)}
                                    placeholder="City, Country"
                                    className="mt-1.5"
                                />
                            </div>
                            <div>
                                <Label>Website</Label>
                                <Input
                                    value={formData.website}
                                    onChange={(e) => updateForm('website', e.target.value)}
                                    placeholder="https://"
                                    className="mt-1.5"
                                />
                            </div>
                        </div>

                        <div>
                            <Label>Availability Status</Label>
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
                <TabsContent value="experience" className="space-y-4 mt-0">
                    <HistoryList
                        items={formData.experience}
                        onChange={(items) => updateForm('experience', items)}
                        type="experience"
                    />
                </TabsContent>

                {/* --- EDUCATION TAB --- */}
                <TabsContent value="education" className="space-y-4 mt-0">
                    <HistoryList
                        items={formData.education}
                        onChange={(items) => updateForm('education', items)}
                        type="education"
                    />
                </TabsContent>

                {/* --- SKILLS TAB --- */}
                <TabsContent value="skills" className="space-y-4 mt-0">
                    <SkillsEditor
                        skills={formData.skills}
                        onChange={(skills) => updateForm('skills', skills)}
                    />
                </TabsContent>

                {/* --- SOCIAL TAB --- */}
                <TabsContent value="social" className="space-y-4 mt-0">
                    <SocialLinksEditor
                        links={formData.socialLinks}
                        onChange={(links) => updateForm('socialLinks', links)}
                    />
                </TabsContent>
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
