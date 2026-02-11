"use client";

import { useState, useEffect, useCallback } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui-custom/Toast";
import { Globe, Users } from "lucide-react";

interface MessagingPrivacySettingsProps {
    userId: string;
}

export default function MessagingPrivacySettings({ userId }: MessagingPrivacySettingsProps) {
    const supabase = createSupabaseBrowserClient();
    const { showToast } = useToast();
    const [privacy, setPrivacy] = useState<"everyone" | "connections">("connections");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const loadPrivacy = useCallback(async () => {
        try {
            const { data, error } = await supabase
                .from("profiles")
                .select("message_privacy")
                .eq("id", userId)
                .single();

            if (error) {
                // Determine default if column missing or other error
                setPrivacy("connections");
                return;
            }
            setPrivacy((data?.message_privacy || "connections") as typeof privacy);
        } catch {
            setPrivacy("connections");
        } finally {
            setLoading(false);
        }
    }, [supabase, userId]);

    useEffect(() => {
        void loadPrivacy();
    }, [loadPrivacy]);

    async function updatePrivacy(newPrivacy: typeof privacy) {
        setSaving(true);
        try {
            const { error } = await supabase
                .from("profiles")
                .update({ message_privacy: newPrivacy })
                .eq("id", userId);

            if (error) throw error;
            setPrivacy(newPrivacy);
            showToast("Messaging privacy updated", "success");
        } catch (error) {
            console.error("Error updating privacy:", error);
            showToast("Failed to update settings", "error");
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return (
            <div className="animate-pulse space-y-4">
                <div className="h-8 bg-zinc-200 dark:bg-zinc-800 rounded w-48" />
                <div className="space-y-3">
                    {[1, 2].map(i => (
                        <div key={i} className="h-16 bg-zinc-200 dark:bg-zinc-800 rounded" />
                    ))}
                </div>
            </div>
        );
    }

    const options = [
        {
            value: "connections" as const,
            icon: Users,
            title: "Connections Only (Default)",
            description: "Only people you are connected with can message you directly.",
            color: "text-blue-600 dark:text-blue-400"
        },
        {
            value: "everyone" as const,
            icon: Globe,
            title: "Everyone",
            description: "Anyone can message you without sending a connection request first.",
            color: "text-green-600 dark:text-green-400"
        }
    ];

    return (
        <div className="space-y-4">
            <div>
                <h3 className="text-lg font-semibold mb-1">Messaging Privacy</h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    Control who can send you messages
                </p>
            </div>

            <div className="space-y-3">
                {options.map((option) => {
                    const Icon = option.icon;
                    const isSelected = privacy === option.value;

                    return (
                        <button
                            key={option.value}
                            onClick={() => !saving && updatePrivacy(option.value)}
                            disabled={saving}
                            className={`w-full text-left p-4 rounded-xl border-2 transition-all ${isSelected
                                ? "border-blue-500 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                                : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700"
                                } ${saving ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                            role="radio"
                            aria-checked={isSelected}
                        >
                            <div className="flex items-start gap-3">
                                <div className={`mt-0.5 ${option.color}`}>
                                    <Icon className="w-5 h-5" />
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                        <h4 className="font-medium">{option.title}</h4>
                                        {isSelected && (
                                            <span className="w-2 h-2 rounded-full bg-blue-600 dark:bg-blue-400" />
                                        )}
                                    </div>
                                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                                        {option.description}
                                    </p>
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
