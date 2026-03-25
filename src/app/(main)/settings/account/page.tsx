"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Button from "@/components/ui-custom/Button";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { DangerZoneCard } from "@/components/settings/ui/DangerZoneCard";
import { useToast } from "@/components/ui-custom/Toast";
import CacheSettingsSection from "@/components/settings/CacheSettingsSection";
import AccountDetailsSection from "@/components/settings/AccountDetailsSection";
import AccountDeletionWizard from "@/components/settings/AccountDeletionWizard";
import PendingDeletionBanner from "@/components/settings/PendingDeletionBanner";
import { getAccountDeletionStatus } from "@/app/actions/account";

export default function AccountPage() {
    const { showToast } = useToast();
    const [showDeleteWizard, setShowDeleteWizard] = useState(false);
    const [deletionStatus, setDeletionStatus] = useState<{
        pending: boolean;
        hardDeleteAt?: string;
    }>({ pending: false });
    const [loadingStatus, setLoadingStatus] = useState(true);
    const router = useRouter();
    const supabase = useMemo(() => createSupabaseBrowserClient(), []);

    const loadDeletionStatus = useCallback(async () => {
        try {
            const status = await getAccountDeletionStatus();
            setDeletionStatus(status);
        } catch {
            // Non-critical
        } finally {
            setLoadingStatus(false);
        }
    }, []);

    useEffect(() => {
        loadDeletionStatus();
    }, [loadDeletionStatus]);

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        showToast("Signed out successfully", "info");
        router.push("/login");
    };

    const handleDeleted = () => {
        setShowDeleteWizard(false);
        showToast("Account scheduled for deletion", "success");
        router.push("/login");
    };

    const handleDeletionCancelled = () => {
        setDeletionStatus({ pending: false });
    };

    return (
        <>
            <div className="space-y-6">
                <SettingsPageHeader
                    title="Account"
                    description="Manage your signed-in account, local app data, and account actions."
                />

                {/* Pending Deletion Banner */}
                {!loadingStatus && deletionStatus.pending && deletionStatus.hardDeleteAt && (
                    <PendingDeletionBanner
                        hardDeleteAt={deletionStatus.hardDeleteAt}
                        onCancelled={handleDeletionCancelled}
                    />
                )}

                <AccountDetailsSection />

                <CacheSettingsSection />

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
                            description={
                                deletionStatus.pending
                                    ? "Your account is scheduled for deletion."
                                    : "Permanently delete your account and all associated data."
                            }
                            right={
                                <Button
                                    variant="danger"
                                    onClick={() => setShowDeleteWizard(true)}
                                    disabled={deletionStatus.pending}
                                    leftIcon={<Trash2 className="h-4 w-4" />}
                                >
                                    {deletionStatus.pending ? "Pending" : "Delete"}
                                </Button>
                            }
                        />
                    </div>
                </DangerZoneCard>
            </div>

            {showDeleteWizard && (
                <AccountDeletionWizard
                    onClose={() => setShowDeleteWizard(false)}
                    onDeleted={handleDeleted}
                    showToast={showToast}
                />
            )}
        </>
    );
}
