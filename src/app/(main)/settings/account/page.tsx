"use client";

import { useEffect, useMemo, useState } from "react";
import Button from "@/components/ui-custom/Button";
import { Download, Plus, Shield, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { DangerZoneCard } from "@/components/settings/ui/DangerZoneCard";
import { useToast } from "@/components/ui-custom/Toast";
import {
    addReservedUsername,
    deleteAccount,
    downloadUserData,
    exportUserData,
    listReservedUsernames,
    removeReservedUsername,
    type ReservedUsernameItem,
} from "@/lib/services/settingsService";
import CacheSettingsSection from "@/components/settings/CacheSettingsSection";

export default function AccountPage() {
    const { showToast } = useToast();
    const [exporting, setExporting] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [confirmText, setConfirmText] = useState("");
    const [reservedUsernames, setReservedUsernames] = useState<ReservedUsernameItem[]>([]);
    const [canManageReservedUsernames, setCanManageReservedUsernames] = useState(false);
    const [loadingReservedUsernames, setLoadingReservedUsernames] = useState(false);
    const [newReservedUsername, setNewReservedUsername] = useState("");
    const [newReservedReason, setNewReservedReason] = useState("");
    const [savingReservedUsername, setSavingReservedUsername] = useState(false);
    const [removingReservedUsername, setRemovingReservedUsername] = useState<string | null>(null);
    const router = useRouter();
    const supabase = createSupabaseBrowserClient();

    const handleExport = async () => {
        setExporting(true);
        try {
            const data = await exportUserData();
            downloadUserData(data);
            showToast("Data exported successfully", "success");
        } catch {
            showToast("Export failed. Please try again.", "error");
        } finally {
            setExporting(false);
        }
    };

    const handleDelete = async () => {
        setDeleting(true);
        try {
            const result = await deleteAccount(confirmText);

            if (result.success) {
                showToast("Account deleted successfully", "success");
                router.push("/login");
            } else {
                showToast(result.message || "Failed to delete account", "error");
            }
        } catch {
            showToast("Error deleting account. Please try again.", "error");
        } finally {
            setDeleting(false);
            setShowDeleteModal(false);
            setConfirmText("");
        }
    };

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        showToast("Signed out successfully", "info");
        router.push("/login");
    };

    const loadReservedUsernames = async () => {
        setLoadingReservedUsernames(true);
        try {
            const result = await listReservedUsernames();
            if (!result.success) {
                setCanManageReservedUsernames(false);
                setReservedUsernames([]);
                return;
            }
            setCanManageReservedUsernames(true);
            setReservedUsernames(result.items);
        } catch (error) {
            console.error("Error loading reserved usernames:", error);
            setCanManageReservedUsernames(false);
            setReservedUsernames([]);
        } finally {
            setLoadingReservedUsernames(false);
        }
    };

    useEffect(() => {
        void loadReservedUsernames();
    }, []);

    const sortedReservedUsernames = useMemo(
        () =>
            [...reservedUsernames].sort((a, b) =>
                a.username.localeCompare(b.username)
            ),
        [reservedUsernames]
    );

    const handleAddReservedUsername = async () => {
        const username = newReservedUsername.trim().toLowerCase();
        if (!username) return;
        setSavingReservedUsername(true);
        try {
            const result = await addReservedUsername(username, newReservedReason.trim() || undefined);
            if (!result.success) {
                showToast(result.message || "Failed to reserve username", "error");
                return;
            }
            setNewReservedUsername("");
            setNewReservedReason("");
            showToast("Reserved username updated", "success");
            await loadReservedUsernames();
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to reserve username";
            showToast(message, "error");
        } finally {
            setSavingReservedUsername(false);
        }
    };

    const handleRemoveReservedUsername = async (username: string) => {
        setRemovingReservedUsername(username);
        try {
            const result = await removeReservedUsername(username);
            if (!result.success) {
                showToast(result.message || "Failed to remove reserved username", "error");
                return;
            }
            showToast("Reserved username removed", "success");
            await loadReservedUsernames();
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to remove reserved username";
            showToast(message, "error");
        } finally {
            setRemovingReservedUsername(null);
        }
    };

    return (
        <>
            <div className="space-y-6">
                <SettingsPageHeader
                    title="Account"
                    description="Manage account-level actions and exports."
                />

                <SettingsSectionCard
                    title="Data export"
                    description="Download a copy of your profile and related data."
                >
                    <SettingsRow
                        title="Export your data"
                        description="Exports a JSON file containing your profile and related entities."
                        right={
                            <Button
                                variant="outline"
                                onClick={handleExport}
                                disabled={exporting}
                                leftIcon={<Download className="h-4 w-4" />}
                            >
                                {exporting ? "Exporting..." : "Export"}
                            </Button>
                        }
                    />
                </SettingsSectionCard>

                <CacheSettingsSection />

                {canManageReservedUsernames && (
                    <SettingsSectionCard
                        title="Reserved usernames"
                        description="Admin-only controls for onboarding username blocks."
                    >
                        <div className="space-y-4">
                            <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                                <input
                                    value={newReservedUsername}
                                    onChange={(event) => setNewReservedUsername(event.target.value)}
                                    placeholder="username"
                                    aria-label="Reserved username"
                                    className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500/30"
                                />
                                <input
                                    value={newReservedReason}
                                    onChange={(event) => setNewReservedReason(event.target.value)}
                                    placeholder="reason (optional)"
                                    aria-label="Reason for reservation (optional)"
                                    className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500/30"
                                />
                                <Button
                                    variant="outline"
                                    onClick={handleAddReservedUsername}
                                    disabled={savingReservedUsername || !newReservedUsername.trim()}
                                    leftIcon={<Plus className="h-4 w-4" />}
                                >
                                    {savingReservedUsername ? "Saving..." : "Add"}
                                </Button>
                            </div>

                            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-800">
                                {loadingReservedUsernames ? (
                                    <div className="p-3 text-sm text-zinc-500">Loading...</div>
                                ) : sortedReservedUsernames.length === 0 ? (
                                    <div className="p-3 text-sm text-zinc-500">No reserved usernames</div>
                                ) : (
                                    sortedReservedUsernames.map((item) => (
                                        <div key={item.username} className="p-3 flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="text-sm font-medium">@{item.username}</div>
                                                <div className="text-xs text-zinc-500 truncate">
                                                    {item.reason || "admin"}
                                                </div>
                                            </div>
                                            <Button
                                                variant="outline"
                                                onClick={() => void handleRemoveReservedUsername(item.username)}
                                                disabled={removingReservedUsername === item.username}
                                                leftIcon={<Shield className="h-4 w-4" />}
                                            >
                                                {removingReservedUsername === item.username ? "Removing..." : "Remove"}
                                            </Button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </SettingsSectionCard>
                )}

                <DangerZoneCard description="Irreversible actions that affect your account.">
                    <div className="space-y-4">
                        <SettingsRow
                            title="Sign out"
                            description="Sign out on this device."
                            right={
                                <Button variant="outline" onClick={handleSignOut}>
                                    Sign out
                                </Button>
                            }
                        />

                        <div className="h-px bg-red-200/60 dark:bg-red-900/40" />

                        <SettingsRow
                            title="Delete account"
                            description="Permanently delete your account and all associated data."
                            right={
                                <Button
                                    variant="danger"
                                    onClick={() => setShowDeleteModal(true)}
                                    disabled={deleting}
                                    leftIcon={<Trash2 className="h-4 w-4" />}
                                >
                                    Delete
                                </Button>
                            }
                        />
                    </div>
                </DangerZoneCard>
            </div>

            {showDeleteModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                                    Delete account
                                </div>
                                <div className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                                    Type <span className="font-semibold">DELETE</span> to confirm. This cannot be undone.
                                </div>
                            </div>
                            <button
                                onClick={() => {
                                    setShowDeleteModal(false);
                                    setConfirmText("");
                                }}
                                className="text-zinc-500 hover:text-zinc-900 dark:text-zinc-50 dark:hover:text-zinc-100"
                                aria-label="Close"
                            >
                                ×
                            </button>
                        </div>

                        <div className="mt-4">
                            <input
                                value={confirmText}
                                onChange={(e) => setConfirmText(e.target.value)}
                                placeholder="Type DELETE"
                                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500/60"
                                autoFocus
                            />
                        </div>

                        <div className="mt-5 flex gap-3">
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setShowDeleteModal(false);
                                    setConfirmText("");
                                }}
                                disabled={deleting}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="danger"
                                onClick={() => {
                                    if (confirmText !== "DELETE") return;
                                    handleDelete();
                                }}
                                disabled={deleting || confirmText !== "DELETE"}
                                leftIcon={<Trash2 className="h-4 w-4" />}
                            >
                                {deleting ? "Deleting..." : "Delete account"}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
