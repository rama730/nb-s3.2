
"use client";

import { useProfile } from "@/hooks/useProfile";
import { ProfileV2Client } from "@/components/profile/v2/ProfileV2Client";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";

interface ProfileShellProps {
    initialData: any; // Server-fetched fallback
    profileId: string;
}

export default function ProfileShell({ initialData, profileId }: ProfileShellProps) {
    // OLD: const { profile, loading } = useLocalProfile(profileId);
    // NEW: Use React Query hook force cache hydration
    const { profile, loading } = useProfile(profileId, initialData?.profile);

    // Merge server fallback with client data
    const displayProfile = profile || initialData?.profile;

    if (!displayProfile && loading) {
        return (
            <div className="h-full min-h-0 bg-white dark:bg-zinc-950 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
            </div>
        );
    }

    if (!displayProfile) {
        return <div>Profile not found</div>;
    }

    return (
        <ProfileV2Client
            profile={displayProfile}
            stats={initialData?.stats}
            isOwner={initialData?.isOwner}
            currentUser={initialData?.currentUser}
            connectionStatus={initialData?.connectionStatus}
            privacyRelationship={initialData?.privacyRelationship}
            lockedShell={initialData?.lockedShell}
            projects={initialData?.projects}
        />
    );
}
