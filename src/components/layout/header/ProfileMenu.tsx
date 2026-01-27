"use client";

import Image from "next/image";

// Avatar component with image support
export function ProfileAvatar({
    profile,
    size = 32,
    priority = false,
}: {
    profile: any | null;
    size?: number;
    priority?: boolean;
}) {
    const profileInitial =
        profile?.fullName?.[0]?.toUpperCase() ||
        profile?.username?.[0]?.toUpperCase() ||
        "U";

    if (profile?.avatarUrl) {
        return (
            <div className="relative rounded-full overflow-hidden ring-2 ring-white dark:ring-zinc-950 group-hover:ring-blue-100 dark:group-hover:ring-blue-900/30 transition-all" style={{ width: size, height: size }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <Image
                    src={profile.avatarUrl}
                    alt={profile.fullName || profile.username || "User"}
                    fill
                    sizes={`${size}px`}
                    // Use eager/high fetch without injecting a <link rel="preload">, which can be noisy in dev.
                    loading={priority ? "eager" : "lazy"}
                    fetchPriority={priority ? "high" : "auto"}
                    className="object-cover"
                    onError={(e) => {
                        // Fallback to initials on error - next/image doesn't support onError same way as img for this specific DOM manipulation logic easily without state
                        // Keeping simple for now or using unoptimized if needed strictly, but let's try standard Image
                        const target = e.target as HTMLImageElement;
                        target.style.display = "none";
                        const parent = target.parentElement;
                        if (parent) {
                            const fallback = parent.querySelector(".avatar-fallback") as HTMLElement;
                            if (fallback) fallback.style.display = "flex";
                        }
                    }}
                />
                <div className="avatar-fallback absolute inset-0 bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-sm font-semibold text-white" style={{ display: "none" }}>
                    {profileInitial}
                </div>
            </div>
        );
    }

    return (
        <div
            className="rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-sm font-semibold text-white ring-2 ring-white dark:ring-zinc-950 group-hover:ring-blue-100 dark:group-hover:ring-blue-900/30 transition-all"
            style={{ width: size, height: size }}
        >
            {profileInitial}
        </div>
    );
}
