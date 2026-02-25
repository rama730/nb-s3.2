"use client";

import { useState, useEffect, useCallback } from "react";
import Button from "@/components/ui-custom/Button";
import { Loader2, Key, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { Passkey } from "@/lib/types/settingsTypes";

interface PasskeysSectionProps {
    initialPasskeys?: Passkey[];
}

export default function PasskeysSection({ initialPasskeys }: PasskeysSectionProps) {
    const hasInitialPasskeys = Array.isArray(initialPasskeys);
    const [passkeys, setPasskeys] = useState<Passkey[]>(initialPasskeys ?? []);
    const [loading, setLoading] = useState(!hasInitialPasskeys);
    const [registering, setRegistering] = useState(false);

    const loadPasskeys = useCallback(async () => {
        try {
            const res = await fetch("/api/v1/auth/passkeys");
            if (!res.ok) {
                setPasskeys([]);
                return;
            }
            const contentType = res.headers.get("content-type") || "";
            if (!contentType.includes("application/json")) {
                setPasskeys([]);
                return;
            }
            const json = await res.json();
            if (json?.success) {
                setPasskeys(json?.data?.passkeys || []);
            }
        } catch {
            setPasskeys([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!hasInitialPasskeys) {
            void loadPasskeys();
        }
    }, [hasInitialPasskeys, loadPasskeys]);

    const handleRegister = async () => {
        setRegistering(true);
        try {
            // In a real app, this would use WebAuthn API
            toast.info("Passkey registration would open here using WebAuthn API");
        } catch (error) {
            console.error("Failed to register passkey:", error);
            toast.error("Failed to register passkey");
        } finally {
            setRegistering(false);
        }
    };

    const [deleteId, setDeleteId] = useState<string | null>(null);

    const handleDelete = async (passkeyId: string) => {
        try {
            const res = await fetch(`/api/v1/auth/passkeys/${passkeyId}`, {
                method: "DELETE",
            });
            if (res.ok) {
                setPasskeys((prev) => prev.filter((p) => p.id !== passkeyId));
            }
        } catch (error) {
            console.error("Failed to delete passkey:", error);
            toast.error("Failed to remove passkey");
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
                                onClick={() => setDeleteId(passkey.id)}
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

            <ConfirmDialog
                open={!!deleteId}
                onOpenChange={(open) => { if (!open) setDeleteId(null); }}
                title="Remove passkey?"
                description="You won't be able to use this passkey to sign in anymore."
                confirmLabel="Remove"
                variant="destructive"
                onConfirm={() => { if (deleteId) void handleDelete(deleteId); }}
            />
        </div>
    );
}
