"use client";

import { useEffect, useState } from "react";
import { Briefcase, Check, ChevronDown, MessageSquare, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { APPLICATION_DECISION_REASON_TEMPLATES, APPLICATION_REJECTION_REASON_OPTIONS } from "@/lib/applications/reasons";

interface ApplicationReviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (message: string, reason?: string) => Promise<void>;
    mode: "accept" | "reject";
    applicantName: string;
    roleTitle: string;
}

export default function ApplicationReviewModal({ isOpen, onClose, onConfirm, mode, applicantName, roleTitle }: ApplicationReviewModalProps) {
    const [message, setMessage] = useState("");
    const [reason, setReason] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const isAccept = mode === "accept";

    useEffect(() => {
        if (isOpen) {
            setMessage("");
            setReason("");
        }
    }, [isOpen, mode, applicantName, roleTitle]);

    const handleSubmit = async () => {
        if (!isAccept && !reason) {
            toast.error("Please select a reason for rejection");
            return;
        }
        setIsSubmitting(true);
        try {
            await onConfirm(message, reason || undefined);
            onClose();
        } catch {
            toast.error("An error occurred");
        } finally {
            setIsSubmitting(false);
        }
    };

    return <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
        <DialogContent className="max-w-md overflow-hidden p-0">
            <DialogHeader className={cn("flex-row items-center gap-3 border-b px-6 py-4 text-left", isAccept ? "border-purple-100 bg-purple-50 dark:border-purple-800 dark:bg-purple-900/20" : "border-red-100 bg-red-50 dark:border-red-800 dark:bg-red-900/20")}>
                <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", isAccept ? "bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-400" : "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400")}>{isAccept ? <Check className="h-5 w-5" /> : <X className="h-5 w-5" />}</div>
                <div><DialogTitle className={cn("text-lg font-bold", isAccept ? "text-purple-900 dark:text-purple-100" : "text-red-900 dark:text-red-100")}>{isAccept ? "Accept Applicant" : "Reject Application"}</DialogTitle><DialogDescription className={cn("text-xs font-medium", isAccept ? "text-purple-700 dark:text-purple-300" : "text-red-700 dark:text-red-300")}>{applicantName} • {roleTitle}</DialogDescription></div>
            </DialogHeader>
            <div className="space-y-5 p-6">
                {!isAccept ? <div className="space-y-2"><label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Rejection Reason <span className="text-red-500">*</span></label><div className="relative"><select value={reason} onChange={(event) => { const next = event.target.value; setReason(next); if (!message.trim()) setMessage(APPLICATION_DECISION_REASON_TEMPLATES[next as keyof typeof APPLICATION_DECISION_REASON_TEMPLATES] ?? ""); }} className="w-full appearance-none rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm transition-colors focus:border-purple-500   dark:border-zinc-700 dark:bg-zinc-800/50"><option value="" disabled>Select a reason...</option>{APPLICATION_REJECTION_REASON_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" /></div></div> : null}
                <div className="space-y-2"><label className="flex items-center justify-between text-sm font-semibold text-zinc-900 dark:text-zinc-100">{isAccept ? "Welcome Message (Optional)" : "Feedback Message (Optional)"}<span className="text-xs font-normal text-zinc-400">Sent via DM</span></label><div className="relative"><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder={isAccept ? "Hey! Excited to have you on the team..." : "Thank you for your interest. Unfortunately..."} className="h-32 w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm transition-colors placeholder:text-zinc-400 focus:border-purple-500   dark:border-zinc-700 dark:bg-zinc-800/50" /><MessageSquare className="absolute bottom-3 right-3 h-4 w-4 text-zinc-300 dark:text-zinc-600" /></div></div>
                {isAccept ? <div className="flex gap-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-700 dark:border-blue-900/20 dark:bg-blue-900/10 dark:text-blue-300"><Briefcase className="h-5 w-5 shrink-0" /><p className="text-xs leading-relaxed">Accepting this applicant will add them to the <strong>{roleTitle}</strong> role and project workspace.</p></div> : null}
            </div>
            <DialogFooter className="border-t border-zinc-200 bg-zinc-50 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-800/50"><Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button><Button type="button" onClick={handleSubmit} disabled={isSubmitting} className={isAccept ? "bg-purple-600 hover:bg-purple-700" : "bg-red-600 hover:bg-red-700"}>{isSubmitting ? "Processing..." : <>{isAccept ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}{isAccept ? "Confirm Acceptance" : "Reject Application"}</>}</Button></DialogFooter>
        </DialogContent>
    </Dialog>;
}
