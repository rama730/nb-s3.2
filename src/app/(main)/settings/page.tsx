"use client";

import { usePrefetchSettings } from "@/hooks/useSettingsQueries";
import { useRouteWarmPrefetch } from "@/hooks/useRouteWarmPrefetch";
import Link from "next/link";

type SettingsItem = {
    href: string;
    title: string;
    desc: string;
    prefetchKey?: "notifications" | "security" | "privacy";
};

const items: SettingsItem[] = [
    {
        href: "/settings/account",
        title: "Account",
        desc: "Email, export, and account actions",
    },
    {
        href: "/settings/security",
        title: "Security",
        desc: "Sessions, passkeys, MFA, and login history",
        prefetchKey: "security",
    },
    {
        href: "/settings/privacy",
        title: "Privacy",
        desc: "Visibility and connection privacy",
        prefetchKey: "privacy",
    },
    {
        href: "/settings/notifications",
        title: "Notifications",
        desc: "Email and in-app preferences",
        prefetchKey: "notifications",
    },
    {
        href: "/settings/appearance",
        title: "Appearance",
        desc: "Theme, accent color, and density",
    },
    {
        href: "/settings/integrations",
        title: "Integrations",
        desc: "Connected services and apps",
    },
    {
        href: "/settings/languages",
        title: "Languages",
        desc: "Code execution runtimes and preferences",
    },
];

export default function Page() {
    const { prefetchNotifications, prefetchSecurity, prefetchPrivacy } =
        usePrefetchSettings();
    const warmPrefetchRoute = useRouteWarmPrefetch();

    const handlePrefetch = (prefetchKey?: SettingsItem["prefetchKey"]) => {
        if (!prefetchKey) return;
        switch (prefetchKey) {
            case "notifications":
                prefetchNotifications();
                break;
            case "security":
                prefetchSecurity();
                break;
            case "privacy":
                prefetchPrivacy();
                break;
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                    Settings
                </h1>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                    Manage your account, privacy, security, and preferences.
                </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {items.map((it) => (
                    <Link
                        key={it.href}
                        href={it.href}
                        data-testid={`settings-card-${it.title.toLowerCase()}`}
                        onPointerEnter={() => {
                            warmPrefetchRoute(it.href);
                            handlePrefetch(it.prefetchKey);
                        }}
                        className="group rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 hover:shadow-sm transition"
                    >
                        <div className="font-medium text-zinc-900 dark:text-zinc-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                            {it.title}
                        </div>
                        <div className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                            {it.desc}
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    );
}
