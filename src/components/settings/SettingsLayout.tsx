"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type ComponentType, type ReactNode } from "react";
import { Bell, ChevronDown, Lock, LogOut, Palette, Plug, Shield, User } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { settingsTabHref } from "@/constants/routes";
import { SETTINGS_SECTION_META } from "@/constants/settings";
import { useAuth } from "@/lib/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useRouteWarmPrefetch } from "@/hooks/useRouteWarmPrefetch";

type SettingsItem = { title: string; tab: string; href: string; icon: ComponentType<{ className?: string }>; description: string };
const settingsItems: SettingsItem[] = [
  { ...SETTINGS_SECTION_META.account, tab: "account", href: settingsTabHref("account"), icon: User },
  { ...SETTINGS_SECTION_META.security, tab: "security", href: settingsTabHref("security"), icon: Shield },
  { ...SETTINGS_SECTION_META.privacy, tab: "privacy", href: settingsTabHref("privacy"), icon: Lock },
  { ...SETTINGS_SECTION_META.notifications, tab: "notifications", href: settingsTabHref("notifications"), icon: Bell },
  { ...SETTINGS_SECTION_META.appearance, tab: "appearance", href: settingsTabHref("appearance"), icon: Palette },
  { ...SETTINGS_SECTION_META.integrations, tab: "integrations", href: settingsTabHref("integrations"), icon: Plug },
];

function SettingsNav({ activeTab, onSignOut }: { activeTab: string; onSignOut: () => void }) {
  const warmPrefetchRoute = useRouteWarmPrefetch();
  return <nav className="space-y-1">{settingsItems.map((item) => {
    const Icon = item.icon;
    const active = activeTab === item.tab;
    return <Link key={item.tab} href={item.href} prefetch={false} aria-current={active ? "page" : undefined} onPointerEnter={() => warmPrefetchRoute(item.href)} onFocus={() => warmPrefetchRoute(item.href)} className={cn("group flex items-start gap-3 rounded-xl transition-colors app-density-nav-item", active ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "hover:bg-zinc-100 dark:hover:bg-zinc-900/50")}>
      <span className={cn("mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg", active ? "bg-white/15 dark:bg-zinc-900/10" : "bg-zinc-100 dark:bg-zinc-900")}><Icon className={cn("h-4 w-4", active ? "text-white dark:text-zinc-900" : "text-zinc-600 dark:text-zinc-300")} /></span>
      <span className="min-w-0"><span className={cn("block text-sm font-medium leading-5", active ? "text-white dark:text-zinc-900" : "text-zinc-900 dark:text-zinc-100")}>{item.title}</span><span className={cn("mt-0.5 block text-xs leading-4", active ? "text-white/70 dark:text-zinc-600" : "text-zinc-500 dark:text-zinc-400")}>{item.description}</span></span>
    </Link>;
  })}<button type="button" onClick={onSignOut} className="mt-1 flex w-full items-start gap-3 rounded-xl text-left transition-colors hover:bg-red-50 dark:hover:bg-red-950/20 app-density-nav-item"><span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-red-100/50 dark:bg-red-950/40"><LogOut className="h-4 w-4 text-red-600 dark:text-red-400" /></span><span><span className="block text-sm font-medium text-red-600 dark:text-red-400">Sign out</span><span className="mt-0.5 block text-xs text-red-500/80 dark:text-red-400/60">Safely sign out of your account</span></span></button></nav>;
}

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") ?? "account";
  const { signOut } = useAuth();
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const active = settingsItems.find((item) => item.tab === activeTab) ?? settingsItems[0]!;
  const ActiveIcon = active.icon;

  return <div className="mx-auto flex h-full min-h-0 max-w-6xl app-density-stack px-4 py-6 sm:px-6 lg:px-8">
    <aside className="hidden h-full w-72 shrink-0 lg:block"><div className="rounded-2xl border border-zinc-200 bg-white/80 backdrop-blur app-density-panel dark:border-zinc-800 dark:bg-zinc-950/60"><div className="px-2 py-2"><div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Settings</div><div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Account & preferences</div></div><SettingsNav activeTab={active.tab} onSignOut={() => setShowSignOutConfirm(true)} /></div></aside>
    <main data-scroll-root="route" className="min-w-0 flex-1 app-scroll app-scroll-y app-scroll-gutter"><details className="mb-4 lg:hidden"><summary className="flex cursor-pointer list-none items-center justify-between rounded-2xl border border-zinc-200 bg-white app-density-panel dark:border-zinc-800 dark:bg-zinc-950"><span className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-900"><ActiveIcon className="h-4 w-4 text-zinc-700 dark:text-zinc-200" /></span><span><span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">{active.title}</span><span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{active.description}</span></span></span><ChevronDown className="h-4 w-4 text-zinc-500" /></summary><div className="mt-2 rounded-2xl border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-950"><SettingsNav activeTab={active.tab} onSignOut={() => setShowSignOutConfirm(true)} /></div></details><div className="space-y-6 pb-10">{children}</div></main>
    <ConfirmDialog open={showSignOutConfirm} onOpenChange={setShowSignOutConfirm} title="Sign out of your account?" description="You will be signed out on this device. Unsaved offline changes or drafts may be lost." confirmLabel="Sign out" variant="destructive" onConfirm={async () => { await signOut(); toast.info("Signed out successfully"); }} />
  </div>;
}
