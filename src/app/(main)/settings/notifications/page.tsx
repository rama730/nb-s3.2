"use client";

import { useCallback, memo, useRef } from "react";
import { Label } from "@/components/ui-custom/Label";
import { Checkbox } from "@/components/ui-custom/Checkbox";
import { Loader2 } from "lucide-react";
import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { useToast } from "@/components/ui-custom/Toast";
import {
    useNotificationPreferences,
    useUpdateNotificationPreferences,
} from "@/hooks/useSettingsQueries";
import type { NotificationPreferences } from "@/lib/types/settingsTypes";

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
    id: keyof NotificationPreferences;
    title: string;
    description: string;
    checked: boolean;
    disabled: boolean;
    onToggle: (key: keyof NotificationPreferences) => void;
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
        (key: keyof NotificationPreferences) => {
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
                description="Choose what you hear about and how you receive it."
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
                title="Delivery"
                description="Where we should deliver notification alerts."
            >
                <div className="space-y-4">
                    <ToggleRow
                        id="email"
                        title="Email notifications"
                        description="Receive important updates via email."
                        checked={!!preferences?.email}
                        disabled={isSaving}
                        onToggle={handleToggle}
                    />
                    <div className="h-px bg-zinc-100 dark:bg-zinc-900" />
                    <ToggleRow
                        id="push"
                        title="Push notifications"
                        description="Receive real-time alerts on supported devices."
                        checked={!!preferences?.push}
                        disabled={isSaving}
                        onToggle={handleToggle}
                    />
                </div>
            </SettingsSectionCard>

            <SettingsSectionCard
                title="Activity types"
                description="Pick which activity types generate notifications."
            >
                <div className="space-y-4">
                    <ToggleRow
                        id="projects"
                        title="Projects"
                        description="New project activity and updates."
                        checked={!!preferences?.projects}
                        disabled={isSaving}
                        onToggle={handleToggle}
                    />
                    <div className="h-px bg-zinc-100 dark:bg-zinc-900" />
                    <ToggleRow
                        id="messages"
                        title="Messages"
                        description="Direct messages and mentions."
                        checked={!!preferences?.messages}
                        disabled={isSaving}
                        onToggle={handleToggle}
                    />
                    <div className="h-px bg-zinc-100 dark:bg-zinc-900" />
                    <ToggleRow
                        id="mentions"
                        title="Mentions"
                        description="When someone mentions you in posts or comments."
                        checked={!!preferences?.mentions}
                        disabled={isSaving}
                        onToggle={handleToggle}
                    />
                </div>
            </SettingsSectionCard>
        </div>
    );
}
