"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Bell, Loader2, LogOut, Search, X } from "lucide-react";

import { ProfileAvatar } from "@/components/layout/header/ProfileAvatar";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { MAIN_NAV_ITEMS, isMainNavRouteActive } from "./nav-items";
import { ROUTES } from "@/constants/routes";
import type { RealtimeHealthState } from "@/components/providers/RealtimeProvider";

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
    messageUnreadCount?: number;
    onOpenNotifications?: () => void;
    onOpenSearch?: () => void;
    onOpenWorkspace?: () => void;
    workspaceActionCount?: number;
    connectionHealth?: RealtimeHealthState;
}) {
    const pathname = usePathname();
    const [isSigningOut, setIsSigningOut] = useState(false);
    const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
    const unreadImportantCount = props.notificationUnreadCount ?? 0;
    const messageUnreadCount = props.messageUnreadCount ?? 0;
    const workspaceActionCount = props.workspaceActionCount ?? 0;
    const connectionNeedsAttention = props.connectionHealth === "offline" || props.connectionHealth === "unavailable";
    const connectionIsReconnecting = props.connectionHealth === "reconnecting";

    const handleSignOut = async () => {
        if (isSigningOut) return;
        setIsSigningOut(true);
        try {
            await props.onSignOut?.();
        } finally {
            setIsSigningOut(false);
        }
    };

    return (
        <Dialog open={props.isOpen} onOpenChange={(open) => { if (!open) props.onClose(); }}>
            <DialogContent
                id="mobile-menu"
                showCloseButton={false}
                className="left-auto right-0 top-0 flex h-dvh w-full max-w-sm translate-x-0 translate-y-0 flex-col rounded-none border-0 p-4 md:hidden"
            >
                <DialogTitle className="sr-only">Mobile navigation</DialogTitle>
                <DialogDescription className="sr-only">Navigate your workspace or sign out.</DialogDescription>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <ProfileAvatar profile={props.profile ?? null} size={36} priority />
                        <div>
                            <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                                {props.profile?.fullName || props.profile?.username || "Account"}
                            </p>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">Quick navigation</p>
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

                <nav className="mt-6 flex flex-1 flex-col gap-2" aria-label="Mobile navigation">
                    <button
                        type="button"
                        onClick={props.onOpenSearch}
                        className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
                    >
                        <Search className="h-4 w-4" />
                        Search current section
                    </button>
                    <button
                        type="button"
                        onClick={props.onOpenWorkspace}
                        className="flex min-h-11 items-center justify-between rounded-xl px-3 py-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
                    >
                        <span className={cn(workspaceActionCount > 0 && "text-rose-500 dark:text-rose-400")}>Workspace</span>
                        {workspaceActionCount > 0 ? (
                            <span aria-label={`${workspaceActionCount} workspace items need attention`} className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                {workspaceActionCount > 99 ? "99+" : workspaceActionCount}
                            </span>
                        ) : null}
                    </button>
                    {MAIN_NAV_ITEMS.map((item) => {
                        const isActive = isMainNavRouteActive(pathname, item.href);
                        const hasUnreadMessages = item.href === ROUTES.MESSAGES && messageUnreadCount > 0;
                        const isConnectionsItem = item.href === ROUTES.PEOPLE;
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                onClick={props.onClose}
                                aria-current={isActive ? "page" : undefined}
                                className={cn(
                                    "flex items-center justify-between rounded-xl px-3 py-3 text-sm font-medium transition-colors",
                                    isActive
                                        ? "bg-primary/10 text-primary"
                                        : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900",
                                )}
                            >
                                <span className="flex items-center gap-3">
                                    <item.icon className={cn(
                                        "h-4 w-4",
                                        isConnectionsItem && connectionNeedsAttention
                                            ? "text-rose-500 dark:text-rose-400"
                                            : isConnectionsItem && connectionIsReconnecting
                                                ? "text-amber-500 dark:text-amber-400"
                                                : hasUnreadMessages && !isActive
                                                    ? "text-rose-500 dark:text-rose-400"
                                                    : "",
                                    )} />
                                    {item.label}
                                </span>
                                {hasUnreadMessages ? (
                                    <span
                                        aria-label={`${messageUnreadCount} unread messages`}
                                        className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold text-white"
                                    >
                                        {messageUnreadCount > 99 ? "99+" : messageUnreadCount}
                                    </span>
                                ) : null}
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
                    onClick={() => setShowSignOutConfirm(true)}
                    disabled={isSigningOut}
                    className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-zinc-200 px-3 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
                >
                    {isSigningOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                    {isSigningOut ? "Signing out..." : "Sign out"}
                </button>

                <ConfirmDialog
                    open={showSignOutConfirm}
                    onOpenChange={setShowSignOutConfirm}
                    title="Sign out of your account?"
                    description="You will be signed out on this device. Unsaved offline changes or drafts may be lost."
                    confirmLabel="Sign out"
                    variant="destructive"
                    loading={isSigningOut}
                    onConfirm={handleSignOut}
                />
            </DialogContent>
        </Dialog>
    );
}
