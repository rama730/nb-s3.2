"use client";

import { useState, useEffect, useCallback } from "react";
import Button from "@/components/ui-custom/Button";
import { Loader2, Key, Plus, Trash2 } from "lucide-react";
import type { Passkey } from "@/lib/types/settingsTypes";

interface PasskeysSectionProps {
    initialPasskeys?: Passkey[];
}

export default function PasskeysSection({ initialPasskeys = [] }: PasskeysSectionProps) {
    const [passkeys, setPasskeys] = useState<Passkey[]>(initialPasskeys);
    const [loading, setLoading] = useState(!initialPasskeys.length);
    const [registering, setRegistering] = useState(false);

    const loadPasskeys = useCallback(async () => {
        try {
            const res = await fetch("/api/v1/auth/passkeys");
            const json = await res.json();
            if (json.success) {
                setPasskeys(json.data.passkeys || []);
            }
        } catch (error) {
            console.error("Failed to load passkeys:", error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!initialPasskeys.length) {
            void loadPasskeys();
        }
    }, [initialPasskeys.length, loadPasskeys]);

    const handleRegister = async () => {
        setRegistering(true);
        try {
            // In a real app, this would use WebAuthn API
            alert("Passkey registration would open here using WebAuthn API");
        } catch (error) {
            console.error("Failed to register passkey:", error);
            alert("Failed to register passkey");
        } finally {
            setRegistering(false);
        }
    };

    const handleDelete = async (passkeyId: string) => {
        if (!confirm("Are you sure you want to remove this passkey?")) return;

        try {
            const res = await fetch(`/api/v1/auth/passkeys/${passkeyId}`, {
                method: "DELETE",
            });
            if (res.ok) {
                setPasskeys((prev) => prev.filter((p) => p.id !== passkeyId));
            }
        } catch (error) {
            console.error("Failed to delete passkey:", error);
            alert("Failed to remove passkey");
        }
    };

    if (loading) {
        return (
            <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading passkeys...
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {passkeys.length > 0 ? (
                <div className="space-y-2">
                    {passkeys.map((passkey) => (
                        <div
                            key={passkey.id}
                            className="flex items-center justify-between p-3 rounded-lg border border-zinc-200 dark:border-zinc-800"
                        >
                            <div className="flex items-center gap-3">
                                <Key className="h-4 w-4 text-zinc-500" />
                                <div>
                                    <div className="text-sm font-medium">{passkey.name || "Passkey"}</div>
                                    <div className="text-xs text-zinc-500">
                                        Created {new Date(passkey.created_at).toLocaleDateString()}
                                        {passkey.last_used && (
                                            <> • Last used {new Date(passkey.last_used).toLocaleDateString()}</>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDelete(passkey.id)}
                            >
                                <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="text-sm text-zinc-500">
                    No passkeys registered. Passkeys provide a secure, passwordless sign-in experience.
                </p>
            )}

            <Button onClick={handleRegister} disabled={registering} leftIcon={<Plus className="h-4 w-4" />}>
                {registering ? (
                    <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Registering...
                    </>
                ) : (
                    "Add passkey"
                )}
            </Button>
        </div>
    );
}
