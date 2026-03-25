"use client";

import { useState, useEffect, useCallback } from "react";
import Button from "@/components/ui-custom/Button";
import { Trash2, Download, ArrowRight, ArrowLeft, X, AlertTriangle, Users, Shield } from "lucide-react";
import { deleteAccount, downloadAccountData } from "@/lib/services/settingsService";
import { getAccountDataSummary, getTransferableProjects, transferProjectOwnership } from "@/app/actions/account";

type WizardStep = 1 | 2 | 3 | 4 | 5;

interface DataSummary {
    projectsCount: number;
    connectionsCount: number;
    messagesCount: number;
    filesCount: number;
    collectionsCount: number;
}

interface TransferableProject {
    id: string;
    title: string;
    slug: string | null;
    members: Array<{ userId: string; username: string | null; fullName: string | null; role: string }>;
}

interface Props {
    onClose: () => void;
    onDeleted: () => void;
    showToast: (message: string, type: "success" | "error" | "info") => void;
}

export default function AccountDeletionWizard({ onClose, onDeleted, showToast }: Props) {
    const [step, setStep] = useState<WizardStep>(1);
    const [loading, setLoading] = useState(false);
    const [dataSummary, setDataSummary] = useState<DataSummary | null>(null);
    const [transferableProjects, setTransferableProjects] = useState<TransferableProject[]>([]);
    const [transferSelections, setTransferSelections] = useState<Record<string, string>>({});
    const [confirmText, setConfirmText] = useState("");
    const [reason, setReason] = useState("");
    const [exporting, setExporting] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [transferring, setTransferring] = useState(false);

    // Load data summary on mount
    useEffect(() => {
        loadDataSummary();
    }, []);

    const loadDataSummary = useCallback(async () => {
        setLoading(true);
        try {
            const [summaryResult, projectsResult] = await Promise.all([
                getAccountDataSummary(),
                getTransferableProjects(),
            ]);
            if (summaryResult.success && summaryResult.summary) {
                setDataSummary(summaryResult.summary);
            }
            if (projectsResult.success && projectsResult.projects) {
                setTransferableProjects(projectsResult.projects);
            }
        } catch {
            showToast("Failed to load account data", "error");
        } finally {
            setLoading(false);
        }
    }, [showToast]);

    const handleExport = async () => {
        setExporting(true);
        try {
            const result = await downloadAccountData();
            if (result.success) {
                showToast("Your data has been downloaded", "success");
            } else {
                showToast(result.message || "Failed to export data", "error");
            }
        } catch {
            showToast("Failed to export data", "error");
        } finally {
            setExporting(false);
        }
    };

    const handleTransferOwnership = async () => {
        const transfers = Object.entries(transferSelections).filter(([, v]) => v);
        if (transfers.length === 0) return;

        setTransferring(true);
        try {
            for (const [projectId, newOwnerId] of transfers) {
                const result = await transferProjectOwnership(projectId, newOwnerId);
                if (!result.success) {
                    showToast(result.error || `Failed to transfer project`, "error");
                }
            }
            showToast("Project ownership transferred successfully", "success");
            // Reload data
            await loadDataSummary();
        } catch {
            showToast("Failed to transfer ownership", "error");
        } finally {
            setTransferring(false);
        }
    };

    const handleDelete = async () => {
        if (confirmText !== "DELETE") return;
        setDeleting(true);
        try {
            const result = await deleteAccount(confirmText, reason || undefined);
            if (result.success) {
                showToast(
                    `Account scheduled for deletion. It will be permanently removed on ${
                        result.hardDeleteAt
                            ? new Date(result.hardDeleteAt).toLocaleDateString()
                            : "in 30 days"
                    }.`,
                    "success"
                );
                onDeleted();
            } else {
                showToast(result.message || "Failed to delete account", "error");
            }
        } catch {
            showToast("Failed to delete account", "error");
        } finally {
            setDeleting(false);
        }
    };

    const stepLabels = ["Summary", "Export", "Transfer", "Consequences", "Confirm"];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
                    <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/40">
                            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
                        </div>
                        <div>
                            <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                                Delete Account
                            </div>
                            <div className="text-xs text-zinc-500">
                                Step {step} of 5: {stepLabels[step - 1]}
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
                        aria-label="Close"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Step Indicator */}
                <div className="flex gap-1 px-6 pt-4">
                    {[1, 2, 3, 4, 5].map((s) => (
                        <div
                            key={s}
                            className={`h-1 flex-1 rounded-full transition-colors ${
                                s <= step
                                    ? "bg-red-500 dark:bg-red-400"
                                    : "bg-zinc-200 dark:bg-zinc-700"
                            }`}
                        />
                    ))}
                </div>

                {/* Content */}
                <div className="px-6 py-5 min-h-[240px]">
                    {/* Step 1: Data Summary */}
                    {step === 1 && (
                        <div className="space-y-4">
                            <p className="text-sm text-zinc-600 dark:text-zinc-300">
                                Deleting your account will affect the following data:
                            </p>
                            {loading ? (
                                <div className="flex items-center justify-center py-8">
                                    <div className="animate-spin rounded-full h-6 w-6 border-2 border-zinc-300 border-t-red-500" />
                                </div>
                            ) : dataSummary ? (
                                <div className="space-y-2">
                                    {[
                                        { label: "Projects", value: dataSummary.projectsCount },
                                        { label: "Connections", value: dataSummary.connectionsCount },
                                        { label: "Messages", value: dataSummary.messagesCount },
                                        { label: "Files", value: dataSummary.filesCount },
                                        { label: "Collections", value: dataSummary.collectionsCount },
                                    ].map(({ label, value }) => (
                                        <div
                                            key={label}
                                            className="flex justify-between items-center py-2 px-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50"
                                        >
                                            <span className="text-sm text-zinc-600 dark:text-zinc-300">{label}</span>
                                            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                                {value.toLocaleString()}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-sm text-zinc-500">Unable to load data summary.</p>
                            )}
                        </div>
                    )}

                    {/* Step 2: Data Export */}
                    {step === 2 && (
                        <div className="space-y-4">
                            <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                                <Download className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                                <div>
                                    <p className="text-sm font-medium text-blue-900 dark:text-blue-200">
                                        Download Your Data
                                    </p>
                                    <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                                        We recommend downloading a copy of your data before proceeding.
                                        This includes your profile, projects, connections, and messages.
                                    </p>
                                </div>
                            </div>
                            <Button
                                variant="outline"
                                onClick={handleExport}
                                disabled={exporting}
                                leftIcon={<Download className="h-4 w-4" />}
                            >
                                {exporting ? "Downloading..." : "Download My Data"}
                            </Button>
                            <p className="text-xs text-zinc-400 dark:text-zinc-500">
                                You can skip this step if you don&apos;t need a copy of your data.
                            </p>
                        </div>
                    )}

                    {/* Step 3: Transfer Ownership */}
                    {step === 3 && (
                        <div className="space-y-4">
                            {transferableProjects.length > 0 ? (
                                <>
                                    <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                                        <Users className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                                        <div>
                                            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                                                Transfer Project Ownership
                                            </p>
                                            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                                                These projects have team members. Transfer ownership to preserve them.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="space-y-3 max-h-[200px] overflow-y-auto">
                                        {transferableProjects.map((project) => (
                                            <div
                                                key={project.id}
                                                className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-700"
                                            >
                                                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-2">
                                                    {project.title}
                                                </p>
                                                <select
                                                    value={transferSelections[project.id] || ""}
                                                    onChange={(e) =>
                                                        setTransferSelections((prev) => ({
                                                            ...prev,
                                                            [project.id]: e.target.value,
                                                        }))
                                                    }
                                                    className="w-full text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1.5 outline-none focus:ring-2 focus:ring-amber-500/30"
                                                >
                                                    <option value="">Don&apos;t transfer (will be deleted)</option>
                                                    {project.members.map((m) => (
                                                        <option key={m.userId} value={m.userId}>
                                                            {m.fullName || m.username || m.userId} ({m.role})
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        ))}
                                    </div>
                                    {Object.values(transferSelections).some(Boolean) && (
                                        <Button
                                            variant="outline"
                                            onClick={handleTransferOwnership}
                                            disabled={transferring}
                                        >
                                            {transferring ? "Transferring..." : "Transfer Now"}
                                        </Button>
                                    )}
                                </>
                            ) : (
                                <div className="flex flex-col items-center justify-center py-8 text-center">
                                    <Users className="h-8 w-8 text-zinc-300 dark:text-zinc-600 mb-3" />
                                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                                        No projects with team members to transfer.
                                    </p>
                                    <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                                        You can proceed to the next step.
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Step 4: Consequences */}
                    {step === 4 && (
                        <div className="space-y-4">
                            <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                                <Shield className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                                <div>
                                    <p className="text-sm font-medium text-red-900 dark:text-red-200">
                                        30-Day Grace Period
                                    </p>
                                    <p className="text-xs text-red-700 dark:text-red-300 mt-1">
                                        Your account will be deactivated immediately but not permanently deleted
                                        for 30 days. You can cancel the deletion and reactivate your account
                                        during this period by logging in.
                                    </p>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
                                    What happens immediately:
                                </p>
                                {[
                                    "Your profile is hidden from all users",
                                    "All connections are removed",
                                    "You are removed from all conversations",
                                    "You are signed out on all devices",
                                ].map((item) => (
                                    <div key={item} className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                                        <span className="text-red-500 mt-0.5">•</span>
                                        {item}
                                    </div>
                                ))}
                            </div>
                            <div className="space-y-2">
                                <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
                                    After 30 days:
                                </p>
                                {[
                                    "All projects and files are permanently deleted",
                                    "All messages and attachments are removed",
                                    "Your authentication record is deleted",
                                    "This action cannot be undone",
                                ].map((item) => (
                                    <div key={item} className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                                        <span className="text-red-500 mt-0.5">•</span>
                                        {item}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Step 5: Final Confirmation */}
                    {step === 5 && (
                        <div className="space-y-4">
                            <p className="text-sm text-zinc-600 dark:text-zinc-300">
                                Type <span className="font-semibold text-red-600 dark:text-red-400">DELETE</span> to
                                confirm you want to delete your account.
                            </p>
                            <input
                                value={confirmText}
                                onChange={(e) => setConfirmText(e.target.value)}
                                placeholder="Type DELETE"
                                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500/60"
                                autoFocus
                            />
                            <div>
                                <label className="text-xs text-zinc-500 dark:text-zinc-400 block mb-1">
                                    Reason for leaving (optional)
                                </label>
                                <textarea
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    placeholder="Help us improve..."
                                    rows={2}
                                    className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-500/30 resize-none"
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
                    <div>
                        {step > 1 && (
                            <Button
                                variant="outline"
                                onClick={() => setStep((s) => (s - 1) as WizardStep)}
                                disabled={deleting}
                                leftIcon={<ArrowLeft className="h-4 w-4" />}
                            >
                                Back
                            </Button>
                        )}
                    </div>
                    <div className="flex gap-3">
                        <Button variant="outline" onClick={onClose} disabled={deleting}>
                            Cancel
                        </Button>
                        {step < 5 ? (
                            <Button
                                variant="danger"
                                onClick={() => setStep((s) => (s + 1) as WizardStep)}
                                rightIcon={<ArrowRight className="h-4 w-4" />}
                            >
                                Continue
                            </Button>
                        ) : (
                            <Button
                                variant="danger"
                                onClick={handleDelete}
                                disabled={deleting || confirmText !== "DELETE"}
                                leftIcon={<Trash2 className="h-4 w-4" />}
                            >
                                {deleting ? "Deleting..." : "Delete Account"}
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
