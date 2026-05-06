"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, LayoutGrid, LogOut, MessageSquare, Settings, Users, X } from "lucide-react";

import { ProfileAvatar } from "@/components/layout/header/ProfileMenu";
import { ROUTES } from "@/constants/routes";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
    { href: ROUTES.HUB, label: "Hub", icon: LayoutGrid },
    { href: ROUTES.PEOPLE, label: "Connections", icon: Users },
    { href: ROUTES.MESSAGES, label: "Messages", icon: MessageSquare },
    { href: ROUTES.SETTINGS, label: "Settings", icon: Settings },
];

export default function MobileMenu(props: {
    isOpen: boolean;
    onClose: () => void;
    profile?: {
        username?: string | null;
        fullName?: string | null;
        avatarUrl?: string | null;
    } | null;
    onSignOut?: () => void | Promise<void>;
    notificationUnreadCount?: number;
    onOpenNotifications?: () => void;
}) {
    const pathname = usePathname();
    const unreadImportantCount = props.notificationUnreadCount ?? 0;
    if (!props.isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm md:hidden">
            <div className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col bg-white p-4 dark:bg-zinc-950">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <ProfileAvatar profile={props.profile ?? null} size={36} priority />
                        <div>
                            <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                                {props.profile?.fullName || props.profile?.username || "Account"}
                            </p>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                Quick navigation
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={props.onClose}
                        className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                        aria-label="Close mobile menu"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <nav className="mt-6 flex flex-1 flex-col gap-2">
                    {NAV_ITEMS.map((item) => {
                        const isActive = pathname?.startsWith(item.href);
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                onClick={props.onClose}
                                className={cn(
                                    "flex items-center justify-between rounded-xl px-3 py-3 text-sm font-medium transition-colors",
                                    isActive
                                        ? "bg-primary/10 text-primary"
                                        : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900",
                                )}
                            >
                                <span className="flex items-center gap-3">
                                    <item.icon className="h-4 w-4" />
                                    {item.label}
                                </span>
                            </Link>
                        );
                    })}
                    <button
                        type="button"
                        onClick={props.onOpenNotifications}
                        className="flex items-center justify-between rounded-xl px-3 py-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
                    >
                        <span className="flex items-center gap-3">
                            <Bell className="h-4 w-4" />
                            Notifications
                        </span>
                        {unreadImportantCount > 0 ? (
                            <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                                {unreadImportantCount > 9 ? "9+" : unreadImportantCount}
                            </span>
                        ) : null}
                    </button>
                </nav>

                <button
                    type="button"
                    onClick={() => void props.onSignOut?.()}
                    className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-zinc-200 px-3 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
                >
                    <LogOut className="h-4 w-4" />
                    Sign out
                </button>
            </div>
        </div>
    );
}
