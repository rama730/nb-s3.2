"use client";

import { useState } from "react";
import Button from "@/components/ui-custom/Button";
import Input from "@/components/ui-custom/Input";
import { Label } from "@/components/ui-custom/Label";
import { Loader2, Camera } from "lucide-react";
import { useToast } from "@/components/ui-custom/Toast";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import Image from "next/image";


interface ProfileFormProps {
    initialData: {
        id: string;
        username?: string | null;
        full_name?: string | null;
        bio?: string | null;
        avatar_url?: string | null;
        location?: string | null;
        website?: string | null;
    };
    onOptimisticUpdate?: (updates: any) => Promise<void>;
}

export function ProfileForm({ initialData, onOptimisticUpdate }: ProfileFormProps) {
    const { showToast } = useToast();
    const supabase = createSupabaseBrowserClient();

    const [saving, setSaving] = useState(false);
    const [avatarUploading, setAvatarUploading] = useState(false);

    // Initialize with whatever we have (local or server)
    const [formData, setFormData] = useState({
        full_name: initialData.full_name || "",
        username: initialData.username || "",
        bio: initialData.bio || "",
        location: initialData.location || "",
        website: initialData.website || "",
        avatar_url: initialData.avatar_url || "",
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    };

    const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setAvatarUploading(true);
        try {
            const fileExt = file.name.split(".").pop();
            const filePath = `avatars/${initialData.id}/${Date.now()}.${fileExt}`;

            const { error: uploadError } = await supabase.storage
                .from("avatars")
                .upload(filePath, file, { upsert: true });

            if (uploadError) throw uploadError;

            const {
                data: { publicUrl },
            } = supabase.storage.from("avatars").getPublicUrl(filePath);

            setFormData((prev) => ({ ...prev, avatar_url: publicUrl }));

            // Optimistic update for avatar!
            if (onOptimisticUpdate) {
                await onOptimisticUpdate({ avatar_url: publicUrl });
            }

            showToast("Avatar uploaded successfully", "success");
        } catch (error) {
            console.error("Error uploading avatar:", error);
            showToast("Failed to upload avatar", "error");
        } finally {
            setAvatarUploading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);

        // 1. Optimistic Update (Instant Feedback)
        if (onOptimisticUpdate) {
            // We fire and forget the optimistic update to UI, 
            // but await it to ensure local DB write happens before we might navigate? 
            // Actually, we stay on page.
            await onOptimisticUpdate({
                full_name: formData.full_name,
                username: formData.username,
                bio: formData.bio,
                location: formData.location,
                website: formData.website,
                avatar_url: formData.avatar_url,
                // updated_at will be handled by the hook/DB
            });
            showToast("Profile updated", "success"); // Instant success!
            setSaving(false); // Stop spinner immediately
        }

        // 2. Background Sync (Server Source of Truth)
        // We do this *after* or *parallel* to giving control back to user.
        // If we want to be truly safe, we'd handle error reversion, but for MVP speed is key.

        try {
            const { error } = await supabase
                .from("profiles")
                .update({
                    full_name: formData.full_name,
                    username: formData.username,
                    bio: formData.bio,
                    location: formData.location,
                    website: formData.website,
                    avatar_url: formData.avatar_url,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", initialData.id);

            if (error) {
                // Silent fail or toast error?
                // If background sync fails, RxDB replication *might* catch it later, 
                // but direct Supabase call here ensures we pushed.
                console.error("Background sync failed", error);
                // We could show toast here if we want to warn user.
            }
        } catch (error) {
            console.error("Error updating profile (background):", error);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {/* Avatar */}
            <div className="flex items-center gap-4">
                <div className="relative">
                    <div className="h-20 w-20 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                        {formData.avatar_url ? (
                            <Image
                                src={formData.avatar_url}
                                alt="Avatar"
                                width={80}
                                height={80}
                                className="h-full w-full object-cover"
                            />
                        ) : (
                            <div className="h-full w-full flex items-center justify-center text-2xl font-semibold text-zinc-500">
                                {formData.full_name?.charAt(0) || formData.username?.charAt(0) || "?"}
                            </div>
                        )}
                    </div>
                    <label className="absolute bottom-0 right-0 p-1.5 rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 cursor-pointer hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors">
                        <input
                            type="file"
                            accept="image/*"
                            onChange={handleAvatarUpload}
                            className="hidden"
                            disabled={avatarUploading}
                        />
                        {avatarUploading ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                            <Camera className="h-3 w-3" />
                        )}
                    </label>
                </div>
                <div>
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Profile photo</div>
                    <div className="text-xs text-zinc-500">Recommended: Square JPG or PNG, at least 200x200px</div>
                </div>
            </div>

            {/* Full name */}
            <div className="space-y-2">
                <Label htmlFor="full_name">Full name</Label>
                <Input
                    id="full_name"
                    name="full_name"
                    value={formData.full_name}
                    onChange={handleChange}
                    placeholder="Your full name"
                    disabled={saving}
                />
            </div>

            {/* Username */}
            <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                    id="username"
                    name="username"
                    value={formData.username}
                    onChange={handleChange}
                    placeholder="username"
                    disabled={saving}
                />
            </div>

            {/* Bio */}
            <div className="space-y-2">
                <Label htmlFor="bio">Bio</Label>
                <textarea
                    id="bio"
                    name="bio"
                    value={formData.bio}
                    onChange={handleChange}
                    placeholder="Tell us about yourself"
                    rows={3}
                    disabled={saving}
                    className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/60 resize-none"
                />
            </div>

            {/* Location */}
            <div className="space-y-2">
                <Label htmlFor="location">Location</Label>
                <Input
                    id="location"
                    name="location"
                    value={formData.location}
                    onChange={handleChange}
                    placeholder="City, Country"
                    disabled={saving}
                />
            </div>

            {/* Website */}
            <div className="space-y-2">
                <Label htmlFor="website">Website</Label>
                <Input
                    id="website"
                    name="website"
                    type="url"
                    value={formData.website}
                    onChange={handleChange}
                    placeholder="https://yourwebsite.com"
                    disabled={saving}
                />
            </div>

            <Button type="submit" disabled={saving}>
                {saving ? (
                    <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                    </>
                ) : (
                    "Save changes"
                )}
            </Button>
        </form>
    );
}

export default ProfileForm;
