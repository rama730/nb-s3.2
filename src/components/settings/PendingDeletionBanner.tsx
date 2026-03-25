"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import Button from "@/components/ui-custom/Button";
import { cancelAccountDeletion } from "@/app/actions/account";
import { useToast } from "@/components/ui-custom/Toast";

interface Props {
    hardDeleteAt: string;
    onCancelled: () => void;
}

export default function PendingDeletionBanner({ hardDeleteAt, onCancelled }: Props) {
    const { showToast } = useToast();
    const [cancelling, setCancelling] = useState(false);

    const deleteDate = new Date(hardDeleteAt);
    const daysRemaining = Math.max(
        0,
        Math.ceil((deleteDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    );

    const handleCancel = async () => {
        setCancelling(true);
        try {
            const result = await cancelAccountDeletion();
            if (result.success) {
                showToast("Account reactivated successfully!", "success");
                onCancelled();
            } else {
                showToast(result.error || "Failed to cancel deletion", "error");
            }
        } catch {
            showToast("Failed to cancel deletion", "error");
        } finally {
            setCancelling(false);
        }
    };

    return (
        <div className="rounded-xl border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-900/20 p-4">
            <div className="flex items-start gap-3">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/40 shrink-0 mt-0.5">
                    <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-red-900 dark:text-red-200">
                        Account Scheduled for Deletion
                    </p>
                    <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                        Your account will be permanently deleted on{" "}
                        <span className="font-semibold">{deleteDate.toLocaleDateString()}</span>
                        {daysRemaining > 0 && (
                            <> ({daysRemaining} day{daysRemaining !== 1 ? "s" : ""} remaining)</>
                        )}
                        . You can cancel the deletion to keep your account.
                    </p>
                    <div className="mt-3">
                        <Button
                            variant="outline"
                            onClick={handleCancel}
                            disabled={cancelling}
                        >
                            {cancelling ? "Cancelling..." : "Cancel Deletion & Reactivate"}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
