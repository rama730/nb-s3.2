"use client";

import { useCallback, memo, useEffect, useMemo, useRef, useState } from "react";
import { Label } from "@/components/ui-custom/Label";
import { Checkbox } from "@/components/ui-custom/Checkbox";
import { BellOff, Loader2 } from "lucide-react";
import {
    getBrowserNotificationSupport,
    requestBrowserNotificationPermission,
    type BrowserNotificationPermissionState,
} from "@/lib/notifications/browser-push";
import {
    getCurrentPushStatus,
    isWebPushSupported,
    subscribeWebPush,
    unsubscribeWebPush,
    type WebPushClientStatus,
} from "@/lib/notifications/web-push-client";
import { Button } from "@/components/ui/button";
import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { useToast } from "@/components/ui-custom/Toast";
import {
    useNotificationPreferences,
    useUpdateNotificationPreferences,
} from "@/hooks/useSettingsQueries";
import type { NotificationPreferences } from "@/lib/types/settingsTypes";
import type { NotificationPreferenceCategory } from "@/lib/notifications/types";
import {
    formatMinuteOfDay,
    isNotificationPauseActive,
    normalizeNotificationPreferences,
    parseTimeInput,
} from "@/lib/notifications/preferences";

// Skeleton component for loading state
const NotificationsSkeleton = memo(function NotificationsSkeleton() {
    return (
        <div className="space-y-6 animate-pulse">
            <div className="space-y-2">
                <div className="h-8 w-48 bg-zinc-200 dark:bg-zinc-800 rounded" />
                <div className="h-4 w-72 bg-zinc-200 dark:bg-zinc-800 rounded" />
            </div>

            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
                <div className="h-5 w-24 bg-zinc-200 dark:bg-zinc-800 rounded mb-4" />
                <div className="space-y-4">
                    {[1, 2].map((i) => (
                        <div key={i} className="flex items-center justify-between">
                            <div className="space-y-2">
                                <div className="h-4 w-32 bg-zinc-200 dark:bg-zinc-800 rounded" />
                                <div className="h-3 w-48 bg-zinc-200 dark:bg-zinc-800 rounded" />
                            </div>
                            <div className="h-5 w-5 bg-zinc-200 dark:bg-zinc-800 rounded" />
                        </div>
                    ))}
                </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
                <div className="h-5 w-32 bg-zinc-200 dark:bg-zinc-800 rounded mb-4" />
                <div className="space-y-4">
                    {[1, 2].map((i) => (
                        <div key={i} className="flex items-center justify-between">
                            <div className="space-y-2">
                                <div className="h-4 w-24 bg-zinc-200 dark:bg-zinc-800 rounded" />
                                <div className="h-3 w-40 bg-zinc-200 dark:bg-zinc-800 rounded" />
                            </div>
                            <div className="h-5 w-5 bg-zinc-200 dark:bg-zinc-800 rounded" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
});

// Debounce hook
function useDebouncedCallback(
    callback: (prefs: NotificationPreferences) => void,
    delay: number
) {
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    return useCallback(
        (prefs: NotificationPreferences) => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            timeoutRef.current = setTimeout(() => callback(prefs), delay);
        },
        [callback, delay]
    );
}

// Toggle row component with optimistic update
interface ToggleRowProps {
    id: NotificationPreferenceCategory;
    title: string;
    description: string;
    checked: boolean;
    disabled: boolean;
    onToggle: (key: NotificationPreferenceCategory) => void;
}

const ToggleRow = memo(function ToggleRow({
    id,
    title,
    description,
    checked,
    disabled,
    onToggle,
}: ToggleRowProps) {
    return (
        <SettingsRow
            title={title}
            description={description}
            right={
                <div className="flex items-center gap-2">
                    <Checkbox
                        id={id}
                        checked={checked}
                        onCheckedChange={() => onToggle(id)}
                        disabled={disabled}
                    />
                    <Label htmlFor={id} className="sr-only">
                        {title}
                    </Label>
                </div>
            }
        />
    );
});

export default function NotificationsPage() {
    const { showToast } = useToast();
    const { data: preferences, isLoading, isError } = useNotificationPreferences();
    const updateMutation = useUpdateNotificationPreferences();
    const pauseActive = useMemo(
        () => preferences ? isNotificationPauseActive(preferences) : false,
        [preferences],
    );

    // Auto-save handler with debounce
    const savePreferences = useCallback(
        (newPrefs: NotificationPreferences) => {
            updateMutation.mutate(newPrefs, {
                onSuccess: () => {
                    showToast("Preferences saved", "success");
                },
                onError: () => {
                    showToast("Failed to save preferences", "error");
                },
            });
        },
        [updateMutation, showToast]
    );

    const debouncedSave = useDebouncedCallback(savePreferences, 500);

    // Toggle handler with optimistic update
    const handleToggle = useCallback(
        (key: NotificationPreferenceCategory) => {
            if (!preferences) return;

            const newPrefs = {
                ...preferences,
                [key]: !preferences[key],
            };

            // Trigger debounced save (optimistic update happens in the mutation)
            debouncedSave(newPrefs);
        },
        [preferences, debouncedSave]
    );

    const handlePause = useCallback((hours: number | null) => {
        if (!preferences) return;
        const pausedUntil = hours === null
            ? null
            : new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
        savePreferences({
            ...preferences,
            pausedUntil,
        });
    }, [preferences, savePreferences]);

    const handleQuietHoursToggle = useCallback(() => {
        if (!preferences) return;
        savePreferences({
            ...preferences,
            quietHours: {
                ...preferences.quietHours,
                enabled: !preferences.quietHours.enabled,
            },
        });
    }, [preferences, savePreferences]);

    const handleQuietHoursTime = useCallback((field: "startMinute" | "endMinute", value: string) => {
        if (!preferences) return;
        const minute = parseTimeInput(value);
        if (minute === null) return;
        savePreferences({
            ...preferences,
            quietHours: {
                ...preferences.quietHours,
                [field]: minute,
            },
        });
    }, [preferences, savePreferences]);

    const [permissionState, setPermissionState] = useState<BrowserNotificationPermissionState>("default");
    const [pushStatus, setPushStatus] = useState<WebPushClientStatus>("idle");
    const [pushBusy, setPushBusy] = useState(false);
    useEffect(() => {
        let cancelled = false;
        setPermissionState(getBrowserNotificationSupport());
        void getCurrentPushStatus()
            .then((status) => {
                if (!cancelled) setPushStatus(status);
            })
            .catch((error) => {
                console.warn("[notifications-settings] failed to read push status", error);
                if (!cancelled) setPushStatus("idle");
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const handlePushToggle = useCallback(async () => {
        if (!preferences) return;
        if (!isWebPushSupported()) {
            showToast("This browser doesn't support web push.", "error");
            return;
        }
        setPushBusy(true);
        try {
            const currentlyOn = Boolean(preferences.delivery?.push) && pushStatus === "subscribed";
            if (currentlyOn) {
                try {
                    const result = await unsubscribeWebPush();
                    if (!result.ok) {
                        throw new Error(result.reason);
                    }
                    setPushStatus("idle");
                    savePreferences({
                        ...preferences,
                        delivery: { ...preferences.delivery, push: false },
                    });
                    if (result.serverCleanupFailed) {
                        showToast("Push was disabled here, but server cleanup did not finish.", "warning");
                    }
                } catch (error) {
                    console.warn("[notifications-settings] failed to disable push", error);
                    showToast("Couldn't disable push notifications.", "error");
                    void getCurrentPushStatus()
                        .then(setPushStatus)
                        .catch(() => {
                            // Keep the current state if the browser subscription cannot be re-read.
                        });
                    return;
                }
            } else {
                const result = await subscribeWebPush();
                if (!result.ok) {
                    const reason = result.reason;
                    showToast(
                        reason === "permission_denied"
                            ? "Push permission was denied in your browser."
                            : reason === "missing_vapid_key"
                                ? "Push is not configured yet. Contact support."
                                : "Couldn't enable push notifications.",
                        "error",
                    );
                    setPushStatus(await getCurrentPushStatus());
                    return;
                }
                setPushStatus("subscribed");
                savePreferences({
                    ...preferences,
                    delivery: { ...preferences.delivery, push: true },
                });
            }
        } finally {
            setPushBusy(false);
        }
    }, [preferences, pushStatus, savePreferences, showToast]);

    const handleBrowserDeliveryToggle = useCallback(async () => {
        if (!preferences) return;
        try {
            const currentlyOn = Boolean(preferences.delivery?.browser);
            if (!currentlyOn) {
                const next = await requestBrowserNotificationPermission();
                setPermissionState(next);
                if (next !== "granted") {
                    showToast(next === "denied" ? "Browser notifications blocked in your browser settings." : "Browser notifications are unavailable here.", "error");
                    return;
                }
            }
            savePreferences({
                ...preferences,
                delivery: {
                    ...preferences.delivery,
                    browser: !currentlyOn,
                },
            });
        } catch (error) {
            console.warn("[notifications-settings] failed to update browser delivery", error);
            showToast("Failed to change browser notification setting", "error");
        }
    }, [preferences, savePreferences, showToast]);

    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const handleExportPreferences = useCallback(() => {
        if (!preferences) return;
        try {
            const json = JSON.stringify(preferences, null, 2);
            const blob = new Blob([json], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const stamp = new Date().toISOString().slice(0, 10);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `notification-preferences-${stamp}.json`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 100);
            showToast("Preferences exported", "success");
        } catch {
            showToast("Couldn't export preferences", "error");
        }
    }, [preferences, showToast]);

    const handleImportClick = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    const handleImportFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        try {
            const text = await file.text();
            const parsed: unknown = JSON.parse(text);
            const normalized = normalizeNotificationPreferences(parsed);
            savePreferences(normalized);
        } catch {
            showToast("Import failed — file isn't a valid preferences JSON", "error");
        }
    }, [savePreferences, showToast]);

    const handleRemoveMute = useCallback((key: string) => {
        if (!preferences) return;
        savePreferences({
            ...preferences,
            mutedScopes: preferences.mutedScopes.filter((scope) => `${scope.kind}:${scope.value}` !== key),
        });
    }, [preferences, savePreferences]);

    const formatMuteScopeKind = useCallback((kind: string) => {
        if (kind === "notification_type") return "notification type";
        return kind;
    }, []);

    if (isLoading) {
        return <NotificationsSkeleton />;
    }

    if (isError) {
        return (
            <div className="text-center py-12">
                <p className="text-red-500">Failed to load notification preferences.</p>
            </div>
        );
    }

    const isSaving = updateMutation.isPending;

    return (
        <div className="space-y-6">
            <SettingsPageHeader
                title="Notifications"
                description="Choose which in-app updates show up in the realtime bell tray."
                action={
                    isSaving ? (
                        <div className="flex items-center gap-2 text-sm text-zinc-500">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Saving...
                        </div>
                    ) : null
                }
            />

            <SettingsSectionCard
                title="In-app categories"
                description="Which event categories surface in the bell tray. Delivery to the desktop, push, or email is controlled below."
            >
                <div className="space-y-4">
                    <ToggleRow
                        id="messages"
                        title="Message bursts"
                        description="Grouped unread conversation activity instead of one row per message."
                        checked={!!preferences?.messages}
                        disabled={isSaving}
                        onToggle={handleToggle}
                    />
                    <div className="h-px bg-zinc-100 dark:bg-zinc-900" />
                    <ToggleRow
                        id="mentions"
                        title="Mentions"
                        description="Direct task discussion mentions that need your attention."
                        checked={!!preferences?.mentions}
                        disabled={isSaving}
                        onToggle={handleToggle}
                    />
                    <div className="h-px bg-zinc-100 dark:bg-zinc-900" />
                    <ToggleRow
                        id="workflows"
                        title="Workflow requests"
                        description="Invites, approvals, feedback requests, availability checks, and follow-ups."
                        checked={!!preferences?.workflows}
                        disabled={isSaving}
                        onToggle={handleToggle}
                    />
                    <div className="h-px bg-zinc-100 dark:bg-zinc-900" />
                    <ToggleRow
                        id="projects"
                        title="Project activity"
                        description="Project-level updates that are important but not noisy."
                        checked={!!preferences?.projects}
                        disabled={isSaving}
                        onToggle={handleToggle}
                    />
                    <div className="h-px bg-zinc-100 dark:bg-zinc-900" />
                    <ToggleRow
                        id="tasks"
                        title="Task updates"
                        description="Assignments and attention states like blocked or done on work tied to you."
                        checked={!!preferences?.tasks}
                        disabled={isSaving}
                        onToggle={handleToggle}
                    />
                    <div className="h-px bg-zinc-100 dark:bg-zinc-900" />
                    <ToggleRow
                        id="applications"
                        title="Applications"
                        description="Incoming applications and decisions on applications you submitted."
                        checked={!!preferences?.applications}
                        disabled={isSaving}
                        onToggle={handleToggle}
                    />
                    <div className="h-px bg-zinc-100 dark:bg-zinc-900" />
                    <ToggleRow
                        id="connections"
                        title="Connections"
                        description="Incoming connection requests and accepted connection requests."
                        checked={!!preferences?.connections}
                        disabled={isSaving}
                        onToggle={handleToggle}
                    />
                </div>
            </SettingsSectionCard>

            <SettingsSectionCard
                title="Quiet controls"
                description="Delay notification delivery temporarily or review muted scopes from tray row actions."
            >
                <div className="space-y-4">
                    <SettingsRow
                        title={pauseActive ? "Notifications are paused" : "Pause notifications"}
                        description={preferences?.pausedUntil
                            ? `New notifications are saved and delayed until ${new Date(preferences.pausedUntil).toLocaleString()}. Existing notifications stay visible.`
                            : "Pause delays new in-app notifications without losing their history. Existing tray items remain available."}
                        right={
                            <div className="flex flex-wrap justify-end gap-2">
                                <Button type="button" variant="outline" size="sm" onClick={() => handlePause(1)} disabled={isSaving}>
                                    1 hour
                                </Button>
                                <Button type="button" variant="outline" size="sm" onClick={() => handlePause(8)} disabled={isSaving}>
                                    8 hours
                                </Button>
                                <Button type="button" variant="outline" size="sm" onClick={() => handlePause(24)} disabled={isSaving}>
                                    Tomorrow
                                </Button>
                                {preferences?.pausedUntil ? (
                                    <Button type="button" variant="ghost" size="sm" onClick={() => handlePause(null)} disabled={isSaving}>
                                        Resume
                                    </Button>
                                ) : null}
                            </div>
                        }
                    />
                    <div className="h-px bg-zinc-100 dark:bg-zinc-900" />
                    <SettingsRow
                        title="Quiet hours"
                        description={preferences?.quietHours.enabled
                            ? `New notifications are saved and delayed between ${formatMinuteOfDay(preferences.quietHours.startMinute)} and ${formatMinuteOfDay(preferences.quietHours.endMinute)} every day.`
                            : "Delay new in-app notifications during a daily window. Existing rows stay visible."}
                        right={
                            <div className="flex flex-wrap items-center justify-end gap-2">
                                <input
                                    type="time"
                                    aria-label="Quiet hours start"
                                    disabled={isSaving || !preferences?.quietHours.enabled}
                                    value={preferences ? formatMinuteOfDay(preferences.quietHours.startMinute) : "22:00"}
                                    onChange={(event) => handleQuietHoursTime("startMinute", event.target.value)}
                                    className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
                                />
                                <span className="text-xs text-zinc-500">to</span>
                                <input
                                    type="time"
                                    aria-label="Quiet hours end"
                                    disabled={isSaving || !preferences?.quietHours.enabled}
                                    value={preferences ? formatMinuteOfDay(preferences.quietHours.endMinute) : "07:00"}
                                    onChange={(event) => handleQuietHoursTime("endMinute", event.target.value)}
                                    className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
                                />
                                <Checkbox
                                    id="quiet-hours-enabled"
                                    checked={!!preferences?.quietHours.enabled}
                                    onCheckedChange={handleQuietHoursToggle}
                                    disabled={isSaving}
                                />
                                <Label htmlFor="quiet-hours-enabled" className="sr-only">
                                    Enable quiet hours
                                </Label>
                            </div>
                        }
                    />
                    <div className="h-px bg-zinc-100 dark:bg-zinc-900" />
                    <div>
                        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                            <BellOff className="h-4 w-4 text-zinc-500" />
                            Muted scopes
                        </div>
                        {preferences?.mutedScopes.length ? (
                            <div className="space-y-2">
                                {preferences.mutedScopes.map((scope) => (
                                    <div
                                        key={`${scope.kind}:${scope.value}`}
                                        className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-800"
                                    >
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                                                {scope.label || scope.value}
                                            </p>
                                            <p className="text-xs capitalize text-zinc-500 dark:text-zinc-400">
                                                {formatMuteScopeKind(scope.kind)} mute
                                            </p>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleRemoveMute(`${scope.kind}:${scope.value}`)}
                                            disabled={isSaving}
                                        >
                                            Remove
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="rounded-xl border border-dashed border-zinc-200 px-3 py-4 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                                Nothing muted yet. Use “Turn off this type” from any tray row when a notification stream gets noisy.
                            </p>
                        )}
                    </div>
                </div>
            </SettingsSectionCard>

            <SettingsSectionCard
                title="Delivery"
                description="Where important notifications reach you beyond the bell tray."
            >
                <div className="space-y-4">
                    <SettingsRow
                        title="Desktop notifications"
                        description={
                            permissionState === "unsupported"
                                ? "This browser doesn't support notifications."
                                : permissionState === "denied"
                                    ? "Blocked in browser settings. Re-enable in your browser to use this."
                                    : "Show a native system notification for important items while this tab is in the background."
                        }
                        right={
                            <div className="flex items-center gap-2">
                                <Checkbox
                                    id="delivery-browser"
                                    checked={Boolean(preferences?.delivery?.browser) && permissionState === "granted"}
                                    onCheckedChange={() => { void handleBrowserDeliveryToggle(); }}
                                    disabled={isSaving || permissionState === "unsupported" || permissionState === "denied"}
                                />
                                <Label htmlFor="delivery-browser" className="sr-only">
                                    Desktop notifications
                                </Label>
                            </div>
                        }
                    />
                    <div className="h-px bg-zinc-100 dark:bg-zinc-900" />
                    <SettingsRow
                        title="Push notifications"
                        description={
                            pushStatus === "unsupported"
                                ? "This browser doesn't support web push."
                                : pushStatus === "denied"
                                    ? "Push permission is blocked. Re-enable it in your browser settings."
                                    : "Deliver important notifications even when this tab is closed. Uses your browser's native push channel."
                        }
                        right={
                            <div className="flex items-center gap-2">
                                <Checkbox
                                    id="delivery-push"
                                    checked={Boolean(preferences?.delivery?.push) && pushStatus === "subscribed"}
                                    onCheckedChange={() => { void handlePushToggle(); }}
                                    disabled={isSaving || pushBusy || pushStatus === "unsupported" || pushStatus === "denied"}
                                />
                                <Label htmlFor="delivery-push" className="sr-only">
                                    Push notifications
                                </Label>
                            </div>
                        }
                    />
                </div>
            </SettingsSectionCard>

            <SettingsSectionCard
                title="Backup & restore"
                description="Export your notification preferences as JSON, or import a saved file to restore them."
            >
                <SettingsRow
                    title="Preferences file"
                    description="Importing replaces all current categories, quiet hours, pause state, muted scopes, and delivery toggles."
                    right={
                        <div className="flex flex-wrap justify-end gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleExportPreferences}
                                disabled={isSaving || !preferences}
                            >
                                Export
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleImportClick}
                                disabled={isSaving}
                            >
                                Import
                            </Button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="application/json,.json"
                                onChange={handleImportFile}
                                className="hidden"
                            />
                        </div>
                    }
                />
            </SettingsSectionCard>
        </div>
    );
}
