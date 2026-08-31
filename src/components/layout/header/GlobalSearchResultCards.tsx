"use client";

import { format, formatDistanceToNow } from "date-fns";
import {
    ArrowRight,
    Bell,
    CalendarDays,
    Loader2,
    Link2,
    Lock,
    MapPin,
    Palette,
    Plug,
    Settings,
    Shield,
    User,
    UserPlus,
    Users,
    X,
} from "lucide-react";
import type { ReactNode } from "react";

import { SkillIcon } from "@/components/skills";
import { SocialPresenceIcon } from "@/components/profile/SocialPresenceIcon";
import { UserAvatar } from "@/components/ui/UserAvatar";
import type {
    GlobalSearchPreview,
    GlobalSearchProfilePreview,
    GlobalSearchProjectPreview,
    GlobalSearchLinkPreview,
    GlobalSearchTaskPreview,
} from "@/hooks/useGlobalSearchPreviews";
import { getTaskPriorityPresentation, getTaskStatusPresentation } from "@/lib/projects/task-workflow";
import { getTaskTitlePresentation } from "@/lib/projects/task-presentation";
import type { SocialPresenceIconKey } from "@/lib/profile/normalization";
import { resolveClientSkill } from "@/lib/skills/client";
import { cn } from "@/lib/utils";
import type { SettingsSearchItem } from "./global-search";

type ResultInteractionProps = {
    index: number;
    activeIndex: number;
    onActivate: (index: number) => void;
};

function ResultShell({
    id,
    index,
    activeIndex,
    onActivate,
    onOpen,
    leading,
    children,
    trailing,
    action,
    onRemove,
    removeLabel,
    ariaLabel,
}: ResultInteractionProps & {
    id: string;
    onOpen: () => void;
    leading?: ReactNode;
    children: ReactNode;
    trailing?: ReactNode;
    action?: ReactNode;
    onRemove?: () => void;
    removeLabel?: string;
    ariaLabel?: string;
}) {
    const selected = index === activeIndex;
    return (
        <div
            id={`global-search-preview-${id}`}
            role="option"
            tabIndex={-1}
            aria-label={ariaLabel}
            aria-selected={selected}
            onMouseEnter={() => onActivate(index)}
            onFocus={() => onActivate(index)}
            onClick={onOpen}
            style={{ contentVisibility: "auto", containIntrinsicSize: "80px" } as React.CSSProperties}
            className={cn(
                "group relative flex w-full items-start gap-3 overflow-hidden rounded-xl border px-3 py-3 text-left outline-none transition-[background-color,border-color,box-shadow] duration-150",
                selected
                    ? "border-zinc-300 bg-zinc-50 shadow-sm ring-1 ring-black/[0.03] dark:border-zinc-700 dark:bg-zinc-900/90 dark:ring-white/[0.04]"
                    : "border-transparent hover:border-zinc-200/80 hover:bg-zinc-50 dark:hover:border-zinc-800 dark:hover:bg-zinc-900/70",
            )}
        >
            {leading ?? null}
            <span className="min-w-0 flex-1">{children}</span>
            {trailing}
            {action}
            {onRemove ? (
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        onRemove();
                    }}
                    className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-400 opacity-100 transition-[color,background-color,opacity] hover:bg-zinc-200 hover:text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none dark:hover:bg-zinc-800 dark:hover:text-zinc-100 sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100"
                    aria-label={removeLabel}
                >
                    <X className="h-4 w-4" aria-hidden />
                </button>
            ) : (
                <ArrowRight className={cn("mt-3 h-4 w-4 shrink-0 transition-colors", selected ? "text-zinc-700 dark:text-zinc-200" : "text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300")} aria-hidden />
            )}
        </div>
    );
}

function SkillIconRail({ skills, max = 6 }: { skills: string[]; max?: number }) {
    if (!skills.length) return null;
    const visible = skills.slice(0, max);
    const hidden = Math.max(0, skills.length - visible.length);
    return (
        <span className="flex shrink-0 items-center gap-2" aria-label={`Skills: ${skills.join(", ")}`}>
            {visible.map((skill) => (
                <span key={skill} title={skill} className="inline-flex h-6 w-6 items-center justify-center text-zinc-600 dark:text-zinc-300">
                    <SkillIcon skill={resolveClientSkill(skill)} size={16} />
                </span>
            ))}
            {hidden ? <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">+{hidden}</span> : null}
        </span>
    );
}

function relativeDate(value: string | null) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return formatDistanceToNow(date, { addSuffix: true });
}

export function ProjectSearchResultCard({ result, onOpen, onRemove, ...interaction }: ResultInteractionProps & { result: GlobalSearchProjectPreview; onOpen: (result: GlobalSearchPreview) => void; onRemove?: () => void }) {
    const connectedFriendLabels = result.connectedFriends.map((friend) => `${friend.name} · ${friend.role}`);
    const metadata = [
        ...connectedFriendLabels,
        result.additionalConnectedFriendsCount > 0
            ? `+${result.additionalConnectedFriendsCount} more connection${result.additionalConnectedFriendsCount === 1 ? "" : "s"}`
            : null,
        `${result.followersCount.toLocaleString()} following`,
        `${result.viewCount.toLocaleString()} ${result.viewCount === 1 ? "view" : "views"}`,
        result.openRolesCount > 0 ? `${result.openRolesCount} open role${result.openRolesCount === 1 ? "" : "s"}` : null,
    ].filter((item): item is string => Boolean(item));
    return (
        <ResultShell
            {...interaction}
            id={result.id}
            onOpen={() => onOpen(result)}
            onRemove={onRemove}
            removeLabel={`Remove ${result.title} from recent searches`}
            trailing={<span className="hidden self-center sm:block"><SkillIconRail skills={result.skills} /></span>}
            ariaLabel={`Open project ${result.title}`}
        >
            <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">{result.title}</span>
                {result.username ? <span className="truncate text-xs text-zinc-400">@{result.username}</span> : null}
            </span>
            <span className="mt-0.5 block truncate text-xs leading-5 text-zinc-500 dark:text-zinc-400">{result.subtitle}</span>
            <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-400 dark:text-zinc-500">
                {metadata.map((item, index) => (
                    <span key={`${index}:${item}`} className={cn(connectedFriendLabels.includes(item) && "font-medium text-zinc-600 dark:text-zinc-300")}>
                        {index > 0 ? <span className="mr-2" aria-hidden>·</span> : null}
                        {item}
                    </span>
                ))}
            </span>
            <span className="mt-2 block sm:hidden"><SkillIconRail skills={result.skills} max={4} /></span>
        </ResultShell>
    );
}

export function ProfileSearchResultCard({ result, onOpen, onConnect, isConnecting, onRemove, ...interaction }: ResultInteractionProps & {
    result: GlobalSearchProfilePreview;
    onOpen: (result: GlobalSearchPreview) => void;
    onConnect: (result: GlobalSearchProfilePreview) => Promise<void>;
    isConnecting: boolean;
    onRemove?: () => void;
}) {
    const lastActive = relativeDate(result.lastActiveAt);
    return (
        <ResultShell
            {...interaction}
            id={result.id}
            onOpen={() => onOpen(result)}
            onRemove={onRemove}
            removeLabel={`Remove ${result.title} from recent searches`}
            leading={result.isLockedProfile
                ? <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-zinc-100 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"><Lock className="h-4 w-4" aria-hidden /></span>
                : <UserAvatar identity={{ username: result.username, fullName: result.title, avatarUrl: result.avatarUrl }} size={40} />}
            trailing={<span className="hidden self-center sm:block"><SkillIconRail skills={result.skills} /></span>}
            action={result.connectionStatus === "none" && result.canConnect ? (
                <button
                    type="button"
                    disabled={isConnecting}
                    onClick={(event) => {
                        event.stopPropagation();
                        void onConnect(result);
                    }}
                    className="inline-flex min-h-9 shrink-0 items-center gap-1.5 self-center rounded-lg border border-zinc-200 px-2.5 text-xs font-semibold text-zinc-700 transition-colors hover:border-primary hover:text-primary disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300"
                    aria-label={`Connect with ${result.title}`}
                >
                    {isConnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : <UserPlus className="h-3.5 w-3.5" aria-hidden />}
                    Connect
                </button>
            ) : null}
            ariaLabel={`Open builder profile ${result.title}`}
        >
            <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">{result.title}</span>
                {result.username ? <span className="truncate text-xs text-zinc-400">@{result.username}</span> : null}
                {result.connectionStatus !== "none" ? <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium capitalize text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">{result.connectionStatus.replace("_", " ")}</span> : null}
            </span>
            <span className="mt-0.5 block truncate text-xs leading-5 text-zinc-500 dark:text-zinc-400">{result.isLockedProfile ? "Limited profile information" : result.subtitle}</span>
            <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-400 dark:text-zinc-500">
                {result.location ? <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden />{result.location}</span> : null}
                {result.mutualConnections > 0 ? <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" aria-hidden />{result.mutualConnections} mutual</span> : null}
                {lastActive ? <span>Active {lastActive}</span> : null}
            </span>
            <span className="mt-2 block sm:hidden"><SkillIconRail skills={result.skills} max={4} /></span>
        </ResultShell>
    );
}

export function TaskSearchResultCard({ result, onOpen, onRemove, ...interaction }: ResultInteractionProps & { result: GlobalSearchTaskPreview; onOpen: (result: GlobalSearchPreview) => void; onRemove?: () => void }) {
    const status = getTaskStatusPresentation(result.status);
    const titlePresentation = getTaskTitlePresentation(result);
    const priority = getTaskPriorityPresentation(result.priority);
    const dueDate = result.dueDate ? new Date(result.dueDate) : null;
    const validDueDate = dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate : null;
    return (
        <ResultShell
            {...interaction}
            id={result.id}
            onOpen={() => onOpen(result)}
            onRemove={onRemove}
            removeLabel={`Remove ${result.title} from recent searches`}
            ariaLabel={`Open task ${result.taskCode}: ${result.title}`}
        >
            <span className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 font-mono text-[11px] font-medium text-zinc-400">{result.taskCode}</span>
                <span className={cn("truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50", titlePresentation.className)} aria-label={titlePresentation.ariaLabel}>{result.title}</span>
            </span>
            <span className="mt-0.5 block truncate text-xs leading-5 text-zinc-500 dark:text-zinc-400">{result.subtitle}</span>
            <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                <span className={cn("rounded-md border px-1.5 py-0.5 font-medium", status.badgeClassName)}>{status.label}</span>
                <span className={cn("rounded-md border px-1.5 py-0.5 font-medium", priority.badgeClassName)}>{priority.label}</span>
                {result.sprintName ? <span className="rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">{result.sprintName}</span> : null}
                {result.storyPoints != null ? <span className="rounded-md border border-zinc-200 px-1.5 py-0.5 text-zinc-500 dark:border-zinc-700 dark:text-zinc-300">{result.storyPoints} pts</span> : null}
                {validDueDate ? <span className="inline-flex items-center gap-1 text-zinc-400"><CalendarDays className="h-3 w-3" aria-hidden />{format(validDueDate, "MMM d")}</span> : null}
            </span>
        </ResultShell>
    );
}

export function LinkSearchResultCard({ result, onOpen, onRemove, ...interaction }: ResultInteractionProps & { result: GlobalSearchLinkPreview; onOpen: (result: GlobalSearchPreview) => void; onRemove?: () => void }) {
    return (
        <ResultShell
            {...interaction}
            id={result.id}
            onOpen={() => onOpen(result)}
            onRemove={onRemove}
            removeLabel={`Remove ${result.title} from recent searches`}
            leading={<span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-300">{result.iconKey ? <SocialPresenceIcon iconKey={result.iconKey as SocialPresenceIconKey} className="h-4 w-4" /> : <Link2 className="h-4 w-4" aria-hidden />}</span>}
            ariaLabel={`Open project link ${result.title}: ${result.subtitle}`}
        >
            <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">{result.title}</span>
                {result.audience === "members" ? <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">Members</span> : null}
            </span>
            <span className="mt-0.5 block truncate text-xs leading-5 text-zinc-500 dark:text-zinc-400">{result.subtitle}</span>
            <span className="mt-1.5 block text-[11px] capitalize text-zinc-400">{result.purpose.replaceAll("-", " ")} · {result.platform}</span>
        </ResultShell>
    );
}

const SETTINGS_ICONS = {
    Account: User,
    Security: Shield,
    Privacy: Lock,
    Notifications: Bell,
    Appearance: Palette,
    Integrations: Plug,
} as const;

export function SettingsSearchResultCard({ result, onOpen, ...interaction }: ResultInteractionProps & { result: SettingsSearchItem; onOpen: (result: SettingsSearchItem) => void }) {
    const Icon = SETTINGS_ICONS[result.section as keyof typeof SETTINGS_ICONS] ?? Settings;
    return (
        <ResultShell
            {...interaction}
            id={`settings-${result.id}`}
            onOpen={() => onOpen(result)}
            leading={<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"><Icon className="h-4 w-4" aria-hidden /></span>}
            ariaLabel={`Open ${result.title} in ${result.section} settings`}
        >
            <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">{result.title}</span>
                <span className="truncate text-[11px] text-zinc-400">Settings / {result.section}</span>
            </span>
            <span className="mt-0.5 block truncate text-xs leading-5 text-zinc-500 dark:text-zinc-400">{result.description}</span>
        </ResultShell>
    );
}
