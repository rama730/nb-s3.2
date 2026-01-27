"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    User,
    Lock,
    Bell,
    Palette,
    Shield,
    Plug,
    ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

type SettingsItem = {
    title: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
    description: string;
};

const settingsItems: SettingsItem[] = [
    {
        title: "Profile",
        href: "/settings/profile",
        icon: User,
        description: "Public profile, avatar, and bio",
    },
    {
        title: "Account",
        href: "/settings/account",
        icon: User,
        description: "Email, export, and account actions",
    },
    {
        title: "Security",
        href: "/settings/security",
        icon: Shield,
        description: "Sessions, passkeys, MFA, and login history",
    },
    {
        title: "Privacy",
        href: "/settings/privacy",
        icon: Lock,
        description: "Visibility, connections, and blocking",
    },
    {
        title: "Notifications",
        href: "/settings/notifications",
        icon: Bell,
        description: "Email and in-app preferences",
    },
    {
        title: "Appearance",
        href: "/settings/appearance",
        icon: Palette,
        description: "Theme, accent color, and density",
    },
    {
        title: "Integrations",
        href: "/settings/integrations",
        icon: Plug,
        description: "Connected services and apps",
    },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const active = useMemo(() => {
        const found = settingsItems.find((i) => pathname === i.href);
        return found ?? settingsItems[0]!;
    }, [pathname]);

    const [mobileOpen, setMobileOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);

    // Close dropdown on Escape
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === "Escape" && mobileOpen) {
            setMobileOpen(false);
            triggerRef.current?.focus();
        }
    }, [mobileOpen]);

    useEffect(() => {
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [handleKeyDown]);

    // Focus trap for mobile dropdown
    useEffect(() => {
        if (mobileOpen && dropdownRef.current) {
            const focusableElements = dropdownRef.current.querySelectorAll<HTMLElement>(
                'a, button, [tabindex]:not([tabindex="-1"])'
            );
            if (focusableElements.length > 0) {
                focusableElements[0]?.focus();
            }
        }
    }, [mobileOpen]);

    return (
        <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
            <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-6">
                <div className="flex gap-6">
                    {/* Desktop sidebar */}
                    <aside className="hidden lg:block w-72 flex-shrink-0">
                        <div className="sticky top-[var(--header-height,64px)] rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/60 backdrop-blur p-3">
                            <div className="px-2 py-2">
                                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                    Settings
                                </div>
                                <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                                    Account & preferences
                                </div>
                            </div>

                            <nav className="mt-2 space-y-1">
                                {settingsItems.map((item) => {
                                    const isActive = pathname === item.href;
                                    const Icon = item.icon;
                                    return (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            className={cn(
                                                "group flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors",
                                                isActive
                                                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                                                    : "hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-900/50"
                                            )}
                                        >
                                            <div
                                                className={cn(
                                                    "mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg",
                                                    isActive
                                                        ? "bg-white/15 dark:bg-zinc-900/10"
                                                        : "bg-zinc-100 dark:bg-zinc-900"
                                                )}
                                            >
                                                <Icon
                                                    className={cn(
                                                        "h-4 w-4",
                                                        isActive
                                                            ? "text-white dark:text-zinc-900"
                                                            : "text-zinc-600 dark:text-zinc-300"
                                                    )}
                                                />
                                            </div>

                                            <div className="min-w-0">
                                                <div
                                                    className={cn(
                                                        "text-sm font-medium leading-5",
                                                        isActive
                                                            ? "text-white dark:text-zinc-900"
                                                            : "text-zinc-900 dark:text-zinc-100"
                                                    )}
                                                >
                                                    {item.title}
                                                </div>
                                                <div
                                                    className={cn(
                                                        "text-xs leading-4 mt-0.5",
                                                        isActive
                                                            ? "text-white/70 dark:text-zinc-600"
                                                            : "text-zinc-500 dark:text-zinc-400"
                                                    )}
                                                >
                                                    {item.description}
                                                </div>
                                            </div>
                                        </Link>
                                    );
                                })}
                            </nav>
                        </div>
                    </aside>

                    {/* Main content */}
                    <div className="flex-1 min-w-0">
                        {/* Mobile section picker */}
                        <div className="lg:hidden mb-4">
                            <button
                                ref={triggerRef}
                                type="button"
                                onClick={() => setMobileOpen((s) => !s)}
                                aria-expanded={mobileOpen}
                                aria-haspopup="listbox"
                                className="w-full flex items-center justify-between rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 py-3"
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="h-9 w-9 rounded-xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center">
                                        <active.icon className="h-4 w-4 text-zinc-700 dark:text-zinc-200" />
                                    </div>
                                    <div className="min-w-0 text-left">
                                        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                            {active.title}
                                        </div>
                                        <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                                            {active.description}
                                        </div>
                                    </div>
                                </div>
                                <ChevronDown
                                    className={cn(
                                        "h-4 w-4 text-zinc-500 transition-transform",
                                        mobileOpen && "rotate-180"
                                    )}
                                />
                            </button>

                            <AnimatePresence>
                                {mobileOpen && (
                                    <motion.div
                                        ref={dropdownRef}
                                        role="listbox"
                                        initial={{ opacity: 0, y: -8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -8 }}
                                        transition={{ duration: 0.15 }}
                                        className="mt-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-2"
                                    >
                                        {settingsItems.map((item) => {
                                            const isActive = pathname === item.href;
                                            const Icon = item.icon;
                                            return (
                                                <Link
                                                    key={item.href}
                                                    href={item.href}
                                                    role="option"
                                                    aria-selected={isActive}
                                                    onClick={() => setMobileOpen(false)}
                                                    className={cn(
                                                        "flex items-center gap-3 rounded-xl px-3 py-2.5",
                                                        isActive
                                                            ? "bg-zinc-100 dark:bg-zinc-900"
                                                            : "hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-900/50"
                                                    )}
                                                >
                                                    <div className="h-8 w-8 rounded-lg bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center">
                                                        <Icon className="h-4 w-4 text-zinc-700 dark:text-zinc-200" />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                                            {item.title}
                                                        </div>
                                                        <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                                                            {item.description}
                                                        </div>
                                                    </div>
                                                </Link>
                                            );
                                        })}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.25, ease: "easeOut" }}
                            className="space-y-6"
                        >
                            {children}
                        </motion.div>
                    </div>
                </div>
            </div>
        </div>
    );
}
