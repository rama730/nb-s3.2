"use client";

import { ProfileV2Client } from "@/components/profile/v2/ProfileV2Client";

interface ProfileShellProps {
    initialData: any;
    profileId: string;
}

export default function ProfileShell({ initialData }: ProfileShellProps) {
    return (
        <ProfileV2Client
            profile={initialData?.profile}
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
