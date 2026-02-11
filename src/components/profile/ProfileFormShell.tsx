
"use client";

import { ProfileForm } from "@/components/profile/ProfileForm";

interface ProfileFormShellProps {
    initialData: any;
}

export default function ProfileFormShell({ initialData }: ProfileFormShellProps) {
    if (!initialData) {
        return <div>Profile not found</div>;
    }

    return <ProfileForm initialData={initialData} />;
}
