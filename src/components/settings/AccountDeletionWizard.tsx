"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, Loader2, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatCalendarDate } from "@/lib/ui/date-formatting";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

interface Props {
    onClose: () => void;
    onDeleted: () => void;
}

export default function AccountDeletionWizard({ onClose, onDeleted }: Props) {
    const [confirmText, setConfirmText] = useState("");
    const [reason, setReason] = useState("");
    const [deleting, setDeleting] = useState(false);

    const handleDelete = async () => {
        if (confirmText !== "DELETE") return;
        setDeleting(true);
        try {
            const response = await fetch("/api/v1/account/delete", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ confirmationText: confirmText, reason: reason || undefined }),
            });
            const payload = await response.json();
            if (!response.ok || payload?.success === false) {
                throw new Error(payload?.message || "Failed to delete account");
            }
            const hardDeleteAt = payload?.data?.hardDeleteAt;
            toast.success(hardDeleteAt
                ? `Account scheduled for deletion on ${formatCalendarDate(hardDeleteAt)}.`
                : "Account scheduled for deletion in 30 days.");
            onDeleted();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to delete account");
        } finally {
            setDeleting(false);
        }
    };

    return <Dialog open onOpenChange={(open) => { if (!open && !deleting) onClose(); }}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-red-600"><TriangleAlert className="h-5 w-5" />Delete account</DialogTitle>
                <DialogDescription>
                    Your profile is hidden immediately. After a 30-day grace period, your account and associated data are permanently deleted.
                </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 text-sm">
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
                    Before deleting, transfer any projects you need to preserve from each project&apos;s Settings tab. You can cancel a pending deletion during the grace period.
                </div>
                <Button variant="outline" asChild>
                    <a href="/api/v1/account/export" download><Download className="h-4 w-4" />Download my data</a>
                </Button>
                <label className="block space-y-1.5">
                    <span>Type <strong>DELETE</strong> to confirm</span>
                    <input value={confirmText} onChange={(event) => setConfirmText(event.target.value)} autoComplete="off" className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none  " />
                </label>
                <label className="block space-y-1.5">
                    <span className="text-muted-foreground">Reason for leaving (optional)</span>
                    <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={1000} className="w-full resize-none rounded-lg border bg-transparent px-3 py-2 outline-none  " />
                </label>
                <p className="text-xs text-muted-foreground">Need to transfer ownership first? <Link href="/projects" onClick={onClose} className="text-primary hover:underline">Open your projects</Link>.</p>
            </div>

            <DialogFooter>
                <Button variant="outline" onClick={onClose} disabled={deleting}>Cancel</Button>
                <Button variant="destructive" onClick={() => void handleDelete()} disabled={deleting || confirmText !== "DELETE"}>
                    {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    Delete account
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>;
}
