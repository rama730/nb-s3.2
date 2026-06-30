"use client";

import { useState } from "react";
import Button from "@/components/ui-custom/Button";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { DangerZoneCard } from "@/components/settings/ui/DangerZoneCard";
import { useToast } from "@/components/ui-custom/Toast";
import CacheSettingsSection from "@/components/settings/CacheSettingsSection";
import AccountDetailsSection from "@/components/settings/AccountDetailsSection";
import AccountDeletionWizard from "@/components/settings/AccountDeletionWizard";
import PendingDeletionBanner from "@/components/settings/PendingDeletionBanner";
import { useAccountDeletionStatus } from "@/hooks/useSettingsQueries";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

export default function AccountPage() {
  const { showToast } = useToast();
  const [showDeleteWizard, setShowDeleteWizard] = useState(false);
  const { data: deletionStatus = { pending: false } } =
    useAccountDeletionStatus();
  const router = useRouter();
  const queryClient = useQueryClient();


  const handleDeleted = () => {
    setShowDeleteWizard(false);
    showToast("Account scheduled for deletion", "success");
    router.push("/login");
  };

  const handleDeletionCancelled = () => {
    queryClient.setQueryData(queryKeys.settings.accountDeletion(), {
      pending: false,
    });
  };

  return (
    <>
      <div className="space-y-6">
        <SettingsPageHeader
          title="Account"
          description="Manage your signed-in account, local app data, and account actions."
        />

        {/* Pending Deletion Banner */}
        {deletionStatus.pending && deletionStatus.hardDeleteAt && (
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
