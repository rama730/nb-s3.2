
"use client";

import { useLocalProfile } from "@/hooks/useLocalProfile";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { Loader2 } from "lucide-react";

interface ProfileFormShellProps {
    initialData: any; // Fallback
    userId: string;
}

export default function ProfileFormShell({ initialData, userId }: ProfileFormShellProps) {
    const { profile, loading, updateProfile } = useLocalProfile(userId);

    // Use local profile if available, otherwise fallback to server initial data
    const displayProfile = profile || initialData;

    // We can show the form even if strictly loading if we have initial data.
    // Only show loader if we have absolutely nothing.
    if (!displayProfile && loading) {
        return (
            <div className="flex justify-center p-8">
                <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
            </div>
        );
    }

    if (!displayProfile) {
        return <div>Profile not found</div>;
    }

    return (
        <ProfileForm
            initialData={displayProfile}
            onOptimisticUpdate={updateProfile}
        />
    );
}
