"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState, type ComponentType } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Globe, Lock, Search, ShieldBan, Users } from "lucide-react";
import { usePrivacySettings } from "@/hooks/useSettingsQueries";
import { invalidatePrivacyDependents } from "@/lib/privacy/client-invalidation";
import { profileHref } from "@/lib/routing/identifiers";
import type { PrivacyBlockedAccount, PrivacyData } from "@/lib/types/settingsTypes";
import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { useToast } from "@/components/ui-custom/Toast";

type ProfileVisibility = PrivacyData["settings"]["profileVisibility"];
type MessagePrivacy = PrivacyData["settings"]["messagePrivacy"];
type ConnectionPrivacy = PrivacyData["settings"]["connectionPrivacy"];

const BLOCKED_SEARCH_MIN_COUNT = 5;

async function patchPrivacy(url: string, body: Record<string, unknown>) {
    const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.success === false) {
        const message =
            (typeof json?.error === "string" && json.error) ||
            (typeof json?.message === "string" && json.message) ||
            "Failed to update privacy settings";
        throw new Error(message);
    }
    return json?.data;
}

async function unblockAccount(userId: string) {
    const res = await fetch(`/api/v1/privacy/blocks/${userId}`, {
        method: "DELETE",
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.success === false) {
        const message =
            (typeof json?.error === "string" && json.error) ||
            (typeof json?.message === "string" && json.message) ||
            "Failed to unblock account";
        throw new Error(message);
    }
    return json?.data;
}

function OptionButton({
    title,
    description,
    icon: Icon,
    selected,
    disabled,
    onClick,
}: {
    title: string;
    description: string;
    icon: ComponentType<{ className?: string }>;
    selected: boolean;
    disabled?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                selected
                    ? "border-indigo-500 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-950/20"
                    : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
            } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
        >
            <div className="flex items-start gap-3">
                <div className={`rounded-xl p-2 ${selected ? "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}>
                    <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</div>
                        {selected ? <span className="inline-block h-2 w-2 rounded-full bg-indigo-500" /> : null}
                    </div>
                    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{description}</p>
                </div>
            </div>
        </button>
    );
}

function OverviewChip({
    label,
    value,
}: {
    label: string;
    value: string | number;
}) {
    return (
        <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">{label}</div>
            <div className="mt-2 text-xl font-semibold leading-none text-zinc-900 dark:text-zinc-100">{value}</div>
        </div>
    );
}

function SegmentedChoice({
    title,
    description,
    selected,
    disabled,
    onClick,
}: {
    title: string;
    description: string;
    selected: boolean;
    disabled?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                selected
                    ? "border-indigo-500 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-950/20"
                    : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
            } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
        >
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</div>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{description}</div>
        </button>
    );
}

function getProfileVisibilityLabel(value: ProfileVisibility) {
    switch (value) {
        case "connections":
            return "Connections only";
        case "private":
            return "Private";
        default:
            return "Public";
    }
}

function getMessagePrivacyLabel(value: MessagePrivacy) {
    return value === "everyone" ? "Everyone" : "Connections only";
}

function getConnectionPrivacyLabel(value: ConnectionPrivacy) {
    if (value === "mutuals_only") return "Mutuals only";
    if (value === "nobody") return "Nobody";
    return "Everyone";
}

function getProfileVisibilityImpact(value: ProfileVisibility) {
    switch (value) {
        case "connections":
            return "Strangers can still find you, but they only see a locked profile shell until you connect.";
        case "private":
            return "Non-connections see a locked shell with limited identity and only the actions you allow.";
        default:
            return "Your full profile is open. Messaging and request rules still apply separately.";
    }
}

function getInteractionSummary(messagePrivacy: MessagePrivacy, connectionPrivacy: ConnectionPrivacy) {
    return `${getMessagePrivacyLabel(messagePrivacy)} can message you. ${getConnectionPrivacyLabel(connectionPrivacy)} can send connection requests.`;
}

function BlockedAccountRow({
    account,
    onUnblock,
    isPending,
}: {
    account: PrivacyBlockedAccount;
    onUnblock: (userId: string) => void;
    isPending: boolean;
}) {
    const displayName = account.fullName || account.username || "Unknown user";
    return (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex min-w-0 items-center gap-3">
                <div className="h-11 w-11 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                    {account.avatarUrl ? (
                        <Image src={account.avatarUrl} alt={displayName} width={44} height={44} className="h-full w-full object-cover" unoptimized />
                    ) : null}
                </div>
                <div className="min-w-0">
                    <Link href={profileHref(account)} className="block truncate text-sm font-semibold text-zinc-900 hover:text-indigo-600 dark:text-zinc-100 dark:hover:text-indigo-300">
                        {displayName}
                    </Link>
                    {account.username ? (
                        <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">@{account.username}</div>
                    ) : null}
                    {account.headline ? (
                        <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">{account.headline}</div>
                    ) : null}
                </div>
            </div>
            <div className="flex items-center gap-3">
                <div className="hidden text-right text-xs text-zinc-500 dark:text-zinc-400 sm:block">
                    {account.blockedAt ? `Blocked ${new Date(account.blockedAt).toLocaleDateString()}` : "Blocked"}
                </div>
                <button
                    type="button"
                    onClick={() => onUnblock(account.id)}
                    disabled={isPending}
                    className="rounded-xl border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                    Unblock
                </button>
            </div>
        </div>
    );
}

export default function PrivacySettings() {
    const { showToast } = useToast();
    const queryClient = useQueryClient();
    const { data, isLoading } = usePrivacySettings();
    const [blockedSearch, setBlockedSearch] = useState("");

    const refreshPrivacy = async () => {
        await invalidatePrivacyDependents(queryClient);
    };

    const profileVisibilityMutation = useMutation({
        mutationFn: (visibility: ProfileVisibility) =>
            patchPrivacy("/api/v1/privacy/profile-visibility", { visibility }),
        onSuccess: async () => {
            showToast("Profile visibility updated", "success");
            await refreshPrivacy();
        },
        onError: (error) => {
            showToast(error instanceof Error ? error.message : "Failed to update profile visibility", "error");
        },
    });

    const messagePrivacyMutation = useMutation({
        mutationFn: (messagePrivacy: MessagePrivacy) =>
            patchPrivacy("/api/v1/privacy/message-privacy", { messagePrivacy }),
        onSuccess: async () => {
            showToast("Messaging privacy updated", "success");
            await refreshPrivacy();
        },
        onError: (error) => {
            showToast(error instanceof Error ? error.message : "Failed to update messaging privacy", "error");
        },
    });

    const connectionPrivacyMutation = useMutation({
        mutationFn: (connectionPrivacy: ConnectionPrivacy) =>
            patchPrivacy("/api/v1/privacy/connection-privacy", { connectionPrivacy }),
        onSuccess: async () => {
            showToast("Connection request privacy updated", "success");
            await refreshPrivacy();
        },
        onError: (error) => {
            showToast(error instanceof Error ? error.message : "Failed to update connection request privacy", "error");
        },
    });

    const unblockMutation = useMutation({
        mutationFn: unblockAccount,
        onSuccess: async () => {
            showToast("Account unblocked", "success");
            await refreshPrivacy();
        },
        onError: (error) => {
            showToast(error instanceof Error ? error.message : "Failed to unblock account", "error");
        },
    });

    const filteredBlockedAccounts = useMemo(() => {
        const items = data?.blockedAccounts ?? [];
        const query = blockedSearch.trim().toLowerCase();
        if (!query) return items;
        return items.filter((account) => {
            const haystack = [account.fullName, account.username, account.headline].filter(Boolean).join(" ").toLowerCase();
            return haystack.includes(query);
        });
    }, [blockedSearch, data?.blockedAccounts]);

    const settings = data?.settings;
    const overview = data?.overview;

    const handleProfileVisibilityChange = (visibility: ProfileVisibility) => {
        if (visibility === settings?.profileVisibility) return;
        if (
            visibility === "private" &&
            settings?.profileVisibility !== "private" &&
            typeof window !== "undefined" &&
            !window.confirm("Switch profile visibility to Private? Strangers will only see a locked profile shell.")
        ) {
            return;
        }
        profileVisibilityMutation.mutate(visibility);
    };

    const handleConnectionPrivacyChange = (connectionPrivacy: ConnectionPrivacy) => {
        if (connectionPrivacy === settings?.connectionPrivacy) return;
        if (
            connectionPrivacy === "nobody" &&
            settings?.connectionPrivacy !== "nobody" &&
            typeof window !== "undefined" &&
            !window.confirm("Turn off new connection requests? People will no longer be able to send you new requests.")
        ) {
            return;
        }
        connectionPrivacyMutation.mutate(connectionPrivacy);
    };

    const handleMessagePrivacyChange = (messagePrivacy: MessagePrivacy) => {
        if (messagePrivacy === settings?.messagePrivacy) return;
        messagePrivacyMutation.mutate(messagePrivacy);
    };

    const handleUnblock = (userId: string) => {
        if (
            typeof window !== "undefined" &&
            !window.confirm("Unblock this account? This will allow future requests and messages again if your privacy settings allow them.")
        ) {
            return;
        }
        unblockMutation.mutate(userId);
    };

    return (
        <div className="space-y-6">
            <SettingsPageHeader
                title="Privacy"
                description="Control who can view your profile, message you, send requests, and which accounts you have blocked."
            />

            <SettingsSectionCard title="Privacy Overview" description="Current visibility and interaction status for your account.">
                {isLoading || !overview ? (
                    <div className="h-16 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
                ) : (
                    <div className="space-y-3">
                        <p className="text-sm text-zinc-600 dark:text-zinc-400">{overview.summary}</p>
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            <OverviewChip label="Profile" value={getProfileVisibilityLabel(overview.profileVisibility)} />
                            <OverviewChip label="Messages" value={getMessagePrivacyLabel(overview.messagePrivacy)} />
                            <OverviewChip label="Requests" value={getConnectionPrivacyLabel(overview.connectionPrivacy)} />
                            <OverviewChip label="Blocked" value={overview.blockedCount} />
                        </div>
                    </div>
                )}
            </SettingsSectionCard>

            <SettingsSectionCard title="Profile Visibility" description="Choose who can open your full profile. Non-eligible viewers will see a locked profile shell instead of full details.">
                <div className="space-y-4">
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">Why this matters: your profile visibility controls how much identity and profile content strangers can open.</p>
                    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/50 dark:text-zinc-400">
                        {data?.previews.profileVisibility || (settings ? getProfileVisibilityImpact(settings.profileVisibility) : "Choose who can open your full profile.")}
                    </div>
                    {data?.previews.visitorProfileHref ? (
                        <div className="flex justify-start">
                            <Link
                                href={data.previews.visitorProfileHref}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
                            >
                                View as visitor
                                <ExternalLink className="h-4 w-4" />
                            </Link>
                        </div>
                    ) : null}
                    <div className="grid gap-3">
                    <OptionButton
                        title="Public"
                        description="Anyone can open your full profile. Private interactions still follow your messaging and request rules."
                        icon={Globe}
                        selected={settings?.profileVisibility === "public"}
                        disabled={profileVisibilityMutation.isPending || !settings}
                        onClick={() => handleProfileVisibilityChange("public")}
                    />
                    <OptionButton
                        title="Connections only"
                        description="People can still find you, but only accepted connections can open the full profile."
                        icon={Users}
                        selected={settings?.profileVisibility === "connections"}
                        disabled={profileVisibilityMutation.isPending || !settings}
                        onClick={() => handleProfileVisibilityChange("connections")}
                    />
                    <OptionButton
                        title="Private"
                        description="Non-connections see a locked profile shell with only limited identity and allowed actions."
                        icon={Lock}
                        selected={settings?.profileVisibility === "private"}
                        disabled={profileVisibilityMutation.isPending || !settings}
                        onClick={() => handleProfileVisibilityChange("private")}
                    />
                    </div>
                </div>
            </SettingsSectionCard>

            <SettingsSectionCard title="Interaction Permissions" description="Control who can message you and who can send connection requests.">
                <div className="space-y-6">
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">Why this matters: these rules decide who can contact you directly and who can start a new relationship.</p>
                    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/50 dark:text-zinc-400">
                        {data?.previews.interactionPermissions || (settings ? getInteractionSummary(settings.messagePrivacy, settings.connectionPrivacy) : "Choose who can message you and who can send requests.")}
                    </div>
                    <div>
                        <div className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Messaging Privacy</div>
                        <div className="grid gap-3 md:grid-cols-2">
                            <SegmentedChoice
                                title="Connections only"
                                description="Only accepted connections can start direct messages with you."
                                selected={settings?.messagePrivacy === "connections"}
                                disabled={messagePrivacyMutation.isPending || !settings}
                                onClick={() => handleMessagePrivacyChange("connections")}
                            />
                            <SegmentedChoice
                                title="Everyone"
                                description="Anyone can start a direct message unless they are blocked."
                                selected={settings?.messagePrivacy === "everyone"}
                                disabled={messagePrivacyMutation.isPending || !settings}
                                onClick={() => handleMessagePrivacyChange("everyone")}
                            />
                        </div>
                    </div>

                    <div>
                        <div className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Connection Requests</div>
                        <div className="grid gap-3 md:grid-cols-3">
                            <SegmentedChoice
                                title="Everyone"
                                description="Any eligible account can send you a connection request."
                                selected={settings?.connectionPrivacy === "everyone"}
                                disabled={connectionPrivacyMutation.isPending || !settings}
                                onClick={() => handleConnectionPrivacyChange("everyone")}
                            />
                            <SegmentedChoice
                                title="Mutual connections only"
                                description="Only people who share at least one accepted connection with you can send a request."
                                selected={settings?.connectionPrivacy === "mutuals_only"}
                                disabled={connectionPrivacyMutation.isPending || !settings}
                                onClick={() => handleConnectionPrivacyChange("mutuals_only")}
                            />
                            <SegmentedChoice
                                title="Nobody"
                                description="No one can send you a new connection request until you change this setting."
                                selected={settings?.connectionPrivacy === "nobody"}
                                disabled={connectionPrivacyMutation.isPending || !settings}
                                onClick={() => handleConnectionPrivacyChange("nobody")}
                            />
                        </div>
                    </div>
                </div>
            </SettingsSectionCard>

            <SettingsSectionCard title="Blocked Accounts" description="Blocked accounts cannot message you, send requests, or appear in discovery and suggestions.">
                <div className="space-y-4">
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">Why this matters: blocking removes profile interaction, messaging, and discovery visibility across the app.</p>
                    {data && data.blockedAccounts.length >= BLOCKED_SEARCH_MIN_COUNT ? (
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                            <input
                                type="text"
                                value={blockedSearch}
                                onChange={(event) => setBlockedSearch(event.target.value)}
                                placeholder="Search blocked accounts"
                                className="w-full rounded-2xl border border-zinc-200 bg-white py-3 pl-10 pr-4 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                            />
                        </div>
                    ) : null}

                    {!data || data.blockedAccounts.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center dark:border-zinc-800 dark:bg-zinc-900/40">
                            <ShieldBan className="mx-auto h-8 w-8 text-zinc-400" />
                            <div className="mt-3 text-sm font-medium text-zinc-900 dark:text-zinc-100">No blocked accounts</div>
                            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                                Use block actions from profiles or message threads when you need to stop all interaction with someone.
                            </p>
                        </div>
                    ) : filteredBlockedAccounts.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
                            No blocked accounts match your search.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {filteredBlockedAccounts.map((account) => (
                                <BlockedAccountRow
                                    key={account.id}
                                    account={account}
                                    isPending={unblockMutation.isPending && unblockMutation.variables === account.id}
                                    onUnblock={handleUnblock}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </SettingsSectionCard>

            <SettingsSectionCard title="Recent Privacy Changes" description="Recent high-signal changes to visibility, interaction rules, and blocked accounts.">
                <div className="space-y-3">
                    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-400">
                        Privacy activity keeps pseudonymous network and device fingerprints for account-history integrity instead of raw IP addresses or full user-agent strings. These records are removed when you delete your account.
                    </div>
                    {!data || data.privacyActivity.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
                            No recent privacy changes.
                        </div>
                    ) : (
                        <div className="space-y-3">
                        {data.privacyActivity.map((entry) => (
                            <div
                                key={entry.id}
                                className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{entry.label}</div>
                                        <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{entry.summary}</div>
                                    </div>
                                    <div className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                                        {new Date(entry.createdAt).toLocaleString()}
                                    </div>
                                </div>
                            </div>
                        ))}
                        </div>
                    )}
                </div>
            </SettingsSectionCard>
        </div>
    );
}
