"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { EditProfileTabs } from "./EditProfileTabs";
import Button from "@/components/ui-custom/Button";
import { updateProfileAction } from "@/app/actions/profile";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui-custom/Toast";
import { useAuth } from "@/lib/hooks/use-auth";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

interface EditProfileModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    profile: any;
    // Optimistic update callback
    onOptimisticUpdate?: (updates: any) => void;
}

export function EditProfileModal({ open, onOpenChange, profile, onOptimisticUpdate }: EditProfileModalProps) {
    const router = useRouter();
    const { showToast } = useToast();
    const queryClient = useQueryClient();
    const { refreshProfile } = useAuth();
    // Removed: useLocalProfile hook
    const [formState, setFormState] = useState<any>(null);
    const [saving, setSaving] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);

    // Reset when opening
    useEffect(() => {
        if (open) {
            setFormState(profile); // Initialize with prop data
            setHasChanges(false);
        }
    }, [open, profile]);

    const handleSave = async () => {
        if (!formState) return;
        setSaving(true);
        try {
            // Transform snake_case formData to camelCase for the action schema
            const transformedData = {
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
            };

            const res = await updateProfileAction(transformedData);
            if (res.success) {
                // 1. Invalidate queries to refetch fresh data for ProfileHeader
                // Invalidate by ID and Username to be safe
                queryClient.invalidateQueries({ queryKey: ['profile'] });

                // 2. Refresh global profile state for TopNav
                await refreshProfile();

                // 3. Optimistic Update (Instant feedback)
                if (onOptimisticUpdate) {
                    onOptimisticUpdate(transformedData);
                }

                showToast("Profile updated successfully", "success");
                onOpenChange(false);

                // If username changed, we might need to redirect. 
                // The action revalidates, but client-side nav might be needed if URL changed.
                if (formState.username && formState.username !== profile.username) {
                    router.push(`/${formState.username}`);
                } else {
                    router.refresh();
                }
            } else {
                showToast(res.error || "Failed to update profile", "error");
            }
        } catch (error) {
            console.error(error);
            showToast("An unexpected error occurred", "error");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px] h-[600px] max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
                <DialogHeader className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800">
                    <DialogTitle>Edit Profile</DialogTitle>
                </DialogHeader>

                <div className="flex-1 min-h-0">
                    <EditProfileTabs
                        profile={profile}
                        onChange={(updates) => {
                            setFormState(updates);
                            setHasChanges(true); // crude check, but works for enabling button
                        }}
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
