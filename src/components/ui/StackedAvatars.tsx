'use client';

import { UserAvatar } from '@/components/ui/UserAvatar';

interface AvatarEntry {
    url: string | null;
    initials: string;
    name?: string | null;
}

interface StackedAvatarsProps {
    avatars: AvatarEntry[];
    max?: number;
    size?: number;
}

export function StackedAvatars({ avatars, max = 3, size = 24 }: StackedAvatarsProps) {
    const visible = avatars.slice(0, max);
    const overflow = avatars.length - visible.length;

    return (
        <div className="flex items-center">
            {visible.map((avatar, index) => (
                <UserAvatar
                    key={`stacked-avatar-${index}`}
                    identity={{
                        avatarUrl: avatar.url,
                        fullName: avatar.name ?? avatar.initials,
                        username: avatar.name ?? avatar.initials,
                    }}
                    size={size}
                    unoptimized
                    className="border-2 border-white dark:border-zinc-950"
                    fallbackDisplayName={avatar.name ?? avatar.initials}
                    fallbackInitials={avatar.initials}
                    fallbackClassName="text-[10px] font-medium text-white"
                    style={{ marginLeft: index > 0 ? -(size * 0.35) : 0, zIndex: visible.length - index }}
                />
            ))}
            {overflow > 0 && (
                <div
                    className="flex shrink-0 items-center justify-center rounded-full border-2 border-white bg-zinc-300 dark:border-zinc-950 dark:bg-zinc-600"
                    style={{ width: size, height: size, marginLeft: -(size * 0.35), zIndex: 0 }}
                >
                    <span className="text-[9px] font-bold text-zinc-600 dark:text-zinc-200">+{overflow}</span>
                </div>
            )}
        </div>
    );
}
