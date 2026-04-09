"use client";

import { UserAvatar } from "@/components/ui/UserAvatar";

export function ProfileAvatar({
    profile,
    size = 32,
    priority = false,
}: {
    profile: any | null;
    size?: number;
    priority?: boolean;
}) {
    return (
        <UserAvatar
            identity={profile}
            size={size}
            priority={priority}
            className="ring-2 ring-white transition-all group-hover:ring-primary/20 dark:ring-zinc-950"
            fallbackClassName="text-sm font-semibold text-white"
        />
    );
}
