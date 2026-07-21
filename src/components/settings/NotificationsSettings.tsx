"use client";

import { useEffect, useState } from "react";
import { BellOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { useNotificationPreferences, useUpdateNotificationPreferences } from "@/hooks/useSettingsQueries";
import type { NotificationPreferences } from "@/lib/types/settingsTypes";
import type { NotificationPreferenceCategory } from "@/lib/notifications/types";
import {
    formatMinuteOfDay,
    isNotificationPauseActive,
    NOTIFICATION_PREFERENCE_CATEGORIES,
    parseTimeInput,
} from "@/lib/notifications/preferences";
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

function NotificationsSkeleton() {
    return <div className="space-y-6 animate-pulse">{[1, 2, 3].map((key) => <div key={key} className="h-40 rounded-2xl border bg-zinc-100 dark:bg-zinc-900" />)}</div>;
}

function ToggleRow({ id, title, description, checked, disabled, onToggle }: {
    id: NotificationPreferenceCategory;
    title: string;
    description: string;
    checked: boolean;
    disabled: boolean;
    onToggle: (key: NotificationPreferenceCategory) => void;
}) {
    return <SettingsRow title={title} description={description} right={<Checkbox id={id} aria-label={title} checked={checked} onCheckedChange={() => onToggle(id)} disabled={disabled} />} />;
}

function DeliveryRow({ id, title, description, checked, disabled, onToggle }: {
    id: string;
    title: string;
    description: string;
    checked: boolean;
    disabled: boolean;
    onToggle: () => void;
}) {
    return <SettingsRow title={title} description={description} right={<Checkbox id={id} aria-label={title} checked={checked} onCheckedChange={onToggle} disabled={disabled} />} />;
}

export default function NotificationsPage() {
    const { data: preferences, isLoading, isError } = useNotificationPreferences();
    const updateMutation = useUpdateNotificationPreferences();
    const [permissionState, setPermissionState] = useState<BrowserNotificationPermissionState>("default");
    const [pushStatus, setPushStatus] = useState<WebPushClientStatus>("idle");
    const [pushBusy, setPushBusy] = useState(false);

    useEffect(() => {
        let active = true;
        setPermissionState(getBrowserNotificationSupport());
        void getCurrentPushStatus().then((status) => { if (active) setPushStatus(status); }).catch(() => undefined);
        return () => { active = false; };
    }, []);

    const save = (next: NotificationPreferences) => updateMutation.mutate(next, {
        onError: () => toast.error("Failed to save preferences"),
    });

    const toggleCategory = (key: NotificationPreferenceCategory) => {
        if (preferences) save({ ...preferences, [key]: !preferences[key] });
    };

    const pause = (hours: number | null) => {
        if (!preferences) return;
        save({ ...preferences, pausedUntil: hours === null ? null : new Date(Date.now() + hours * 3_600_000).toISOString() });
    };

    const setQuietTime = (field: "startMinute" | "endMinute", value: string) => {
        if (!preferences) return;
        const minute = parseTimeInput(value);
        if (minute !== null) save({ ...preferences, quietHours: { ...preferences.quietHours, [field]: minute } });
    };

    const toggleBrowser = async () => {
        if (!preferences) return;
        const currentlyOn = preferences.delivery.browser;
        if (!currentlyOn) {
            const permission = await requestBrowserNotificationPermission();
            setPermissionState(permission);
            if (permission !== "granted") {
                toast.error(permission === "denied" ? "Browser notifications are blocked in browser settings." : "Browser notifications are unavailable here.");
                return;
            }
        }
        save({ ...preferences, delivery: { ...preferences.delivery, browser: !currentlyOn } });
    };

    const togglePush = async () => {
        if (!preferences || !isWebPushSupported()) {
            toast.error("This browser doesn't support web push.");
            return;
        }
        setPushBusy(true);
        try {
            const currentlyOn = preferences.delivery.push && pushStatus === "subscribed";
            if (currentlyOn) {
                const result = await unsubscribeWebPush();
                if (!result.ok) throw new Error(result.reason);
                setPushStatus("idle");
                save({ ...preferences, delivery: { ...preferences.delivery, push: false } });
                if (result.serverCleanupFailed) toast.warning("Push was disabled here, but server cleanup did not finish.");
                return;
            }
            const result = await subscribeWebPush();
            if (!result.ok) {
                const messages: Record<string, string> = {
                    permission_denied: "Push permission was denied in your browser.",
                    missing_vapid_key: "Push is not configured yet. Contact support.",
                };
                toast.error(messages[result.reason] || "Couldn't enable push notifications.");
                setPushStatus(await getCurrentPushStatus());
                return;
            }
            setPushStatus("subscribed");
            save({ ...preferences, delivery: { ...preferences.delivery, push: true } });
        } catch {
            toast.error("Couldn't change push notifications.");
        } finally {
            setPushBusy(false);
        }
    };

    if (isLoading) return <NotificationsSkeleton />;
    if (isError || !preferences) return <p className="py-12 text-center text-red-500">Failed to load notification preferences.</p>;

    const isSaving = updateMutation.isPending;
    const pauseActive = isNotificationPauseActive(preferences);
    const deliveryDescriptions = {
        browser: permissionState === "unsupported"
            ? "This browser doesn't support notifications."
            : permissionState === "denied"
                ? "Blocked in browser settings."
                : "Show native system notifications while this tab is in the background.",
        push: pushStatus === "unsupported"
            ? "This browser doesn't support web push."
            : pushStatus === "denied"
                ? "Push permission is blocked in browser settings."
                : "Deliver important notifications even when this tab is closed.",
    };

    return <div className="space-y-6">
        <SettingsPageHeader title="Notifications" description="Choose which in-app updates show up in the realtime bell tray." action={isSaving ? <span className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" />Saving...</span> : null} />

        <SettingsSectionCard title="In-app categories" description="Choose the event categories shown in the bell tray.">
            <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {NOTIFICATION_PREFERENCE_CATEGORIES.map((category) => <ToggleRow key={category.key} id={category.key} title={category.title} description={category.description} checked={preferences[category.key]} disabled={isSaving} onToggle={toggleCategory} />)}
            </div>
        </SettingsSectionCard>

        <SettingsSectionCard title="Quiet controls" description="Delay notifications temporarily or review muted scopes.">
            <div className="space-y-4">
                <SettingsRow title={pauseActive ? "Notifications are paused" : "Pause notifications"} description={preferences.pausedUntil ? `Delivery resumes ${new Date(preferences.pausedUntil).toLocaleString()}.` : "New notifications are saved while delivery is paused."} right={<div className="flex flex-wrap gap-2">{[[1, "1 hour"], [8, "8 hours"], [24, "Tomorrow"]] .map(([hours, label]) => <Button key={String(hours)} type="button" variant="outline" size="sm" onClick={() => pause(Number(hours))} disabled={isSaving}>{label}</Button>)}{preferences.pausedUntil ? <Button type="button" variant="ghost" size="sm" onClick={() => pause(null)} disabled={isSaving}>Resume</Button> : null}</div>} />
                <SettingsRow title="Quiet hours" description={preferences.quietHours.enabled ? `Delay delivery between ${formatMinuteOfDay(preferences.quietHours.startMinute)} and ${formatMinuteOfDay(preferences.quietHours.endMinute)}.` : "Set a daily delivery window."} right={<div className="flex items-center gap-2">{(["startMinute", "endMinute"] as const).map((field) => <input key={field} type="time" aria-label={field === "startMinute" ? "Quiet hours start" : "Quiet hours end"} value={formatMinuteOfDay(preferences.quietHours[field])} disabled={isSaving || !preferences.quietHours.enabled} onChange={(event) => setQuietTime(field, event.target.value)} className="h-8 rounded-md border bg-transparent px-2 text-sm disabled:opacity-50" />)}<Checkbox aria-label="Enable quiet hours" checked={preferences.quietHours.enabled} onCheckedChange={() => save({ ...preferences, quietHours: { ...preferences.quietHours, enabled: !preferences.quietHours.enabled } })} disabled={isSaving} /></div>} />
                <div>
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><BellOff className="h-4 w-4 text-zinc-500" />Muted scopes</h3>
                    {preferences.mutedScopes.length ? <div className="space-y-2">{preferences.mutedScopes.map((scope) => <div key={`${scope.kind}:${scope.value}`} className="flex items-center justify-between rounded-xl border px-3 py-2"><div><p className="text-sm font-medium">{scope.label || scope.value}</p><p className="text-xs capitalize text-zinc-500">{(scope.kind === "notification_type" ? "notification type" : scope.kind)} mute</p></div><Button type="button" variant="ghost" size="sm" onClick={() => save({ ...preferences, mutedScopes: preferences.mutedScopes.filter((item) => item !== scope) })} disabled={isSaving}>Remove</Button></div>)}</div> : <p className="rounded-xl border border-dashed px-3 py-4 text-sm text-zinc-500">Nothing muted yet.</p>}
                </div>
            </div>
        </SettingsSectionCard>

        <SettingsSectionCard title="Delivery" description="Where important notifications reach you beyond the bell tray.">
            <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
                <DeliveryRow id="delivery-browser" title="Desktop notifications" description={deliveryDescriptions.browser} checked={preferences.delivery.browser && permissionState === "granted"} disabled={isSaving || permissionState === "unsupported" || permissionState === "denied"} onToggle={() => void toggleBrowser()} />
                <DeliveryRow id="delivery-push" title="Push notifications" description={deliveryDescriptions.push} checked={preferences.delivery.push && pushStatus === "subscribed"} disabled={isSaving || pushBusy || pushStatus === "unsupported" || pushStatus === "denied"} onToggle={() => void togglePush()} />
            </div>
        </SettingsSectionCard>
    </div>;
}
