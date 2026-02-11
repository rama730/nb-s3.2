"use client";

import { StopCircle } from "lucide-react";
import { useToast } from "@/components/ui-custom/Toast";
import { useState, useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import ConnectionPrivacySettings from "./ConnectionPrivacySettings";
import MessagingPrivacySettings from "./MessagingPrivacySettings";
import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";

export default function PrivacySettings() {
    const { showToast } = useToast();
    const supabase = createSupabaseBrowserClient();
    const [isPrivate, setIsPrivate] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            const { data: { user } } = await supabase.auth.getUser();
            setUserId(user?.id || null);

            if (user) {
                try {
                    const { data } = await supabase
                        .from('profiles')
                        .select('is_private')
                        .eq('id', user.id)
                        .single();

                    if (data) {
                        setIsPrivate(data.is_private || false);
                    }
                } catch {
                    // Column may not exist - use default
                    setIsPrivate(false);
                } finally {
                    setLoading(false);
                }
            } else {
                setLoading(false);
            }
        })();
    }, [supabase]);

    const handleTogglePrivate = async () => {
        if (!userId) return;

        // Optimistic update
        const previousState = isPrivate;
        const newState = !isPrivate;
        setIsPrivate(newState);

        try {
            const { error } = await supabase
                .from('profiles')
                .update({ is_private: newState })
                .eq('id', userId);

            if (error) throw error;

            showToast(
                newState ? "Account is now private" : "Account is now public",
                newState ? "success" : "info"
            );
        } catch (err) {
            // Revert on error
            setIsPrivate(previousState);
            showToast("Failed to update privacy settings", "error");
            console.error("Error updating privacy:", err);
        }
    };

    return (
        <div className="space-y-6">
            <SettingsPageHeader
                title="Privacy"
                description="Control who can see your content and how others can interact with you."
            />

            <SettingsSectionCard
                title="Account visibility"
                description="Manage high-level privacy for your profile."
            >
                <SettingsRow
                    title="Private account"
                    description="When enabled, only approved people can see your content and profile details."
                    right={
                        loading ? (
                            <div className="w-11 h-6 bg-zinc-200 dark:bg-zinc-800 rounded-full animate-pulse" />
                        ) : (
                            <button
                                onClick={handleTogglePrivate}
                                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${isPrivate ? 'bg-blue-600' : 'bg-zinc-200 dark:bg-zinc-700'}`}
                            >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white dark:bg-zinc-900 transition-transform ${isPrivate ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                        )
                    }
                />
            </SettingsSectionCard>

            {userId && (
                <>
                    <SettingsSectionCard
                        title="Connection privacy"
                        description="Control your connection requests and visibility."
                    >
                        <ConnectionPrivacySettings userId={userId} />
                    </SettingsSectionCard>

                    <SettingsSectionCard
                        title="Messaging privacy"
                        description="Control who can send you direct messages."
                    >
                        <MessagingPrivacySettings userId={userId} />
                    </SettingsSectionCard>
                </>
            )}

            <SettingsSectionCard
                title="Blocked accounts"
                description="Manage accounts you have blocked."
                className="opacity-60 pointer-events-none grayscale"
            >
                <div className="flex items-center justify-between">
                    <div className="flex gap-3 items-center">
                        <StopCircle className="w-5 h-5 text-zinc-400" />
                        <div>
                            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                Blocked accounts
                            </div>
                            <div className="text-xs text-zinc-500">Coming soon</div>
                        </div>
                    </div>
                    <button className="text-sm font-medium text-zinc-500">Manage</button>
                </div>
            </SettingsSectionCard>
        </div>
    );
}
