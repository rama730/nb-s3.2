'use client';

import Image from 'next/image';

interface AvatarEntry {
    url: string | null;
    initials: string;
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
                <div
                    key={`stacked-avatar-${index}`}
                    className="flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-zinc-200 dark:border-zinc-950 dark:bg-zinc-700"
                    style={{ width: size, height: size, marginLeft: index > 0 ? -(size * 0.35) : 0, zIndex: visible.length - index }}
                >
                    {avatar.url ? (
                        <Image src={avatar.url} alt="" width={size} height={size} unoptimized className="h-full w-full object-cover" />
                    ) : (
                        <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-300">{avatar.initials}</span>
                    )}
                </div>
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
