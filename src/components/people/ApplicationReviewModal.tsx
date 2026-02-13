"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, X, MessageSquare, Briefcase, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ApplicationReviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (message: string, reason?: string) => Promise<void>;
    mode: "accept" | "reject";
    applicantName: string;
    roleTitle: string;
}

const REJECTION_REASONS = [
    { value: "skills_mismatch", label: "Skills Mismatch" },
    { value: "role_filled", label: "Position Filled" },
    { value: "availability", label: "Availability Conflict" },
    { value: "experience", label: "Insufficient Experience" },
    { value: "other", label: "Other" },
];

const REJECTION_REASON_TEMPLATES: Record<string, string> = {
    skills_mismatch: "Thanks for applying. Your profile is strong, but we currently need a closer stack match for this role.",
    role_filled: "Thanks for applying. This role has been filled for now.",
    availability: "Thanks for applying. We currently need availability that better aligns with the team schedule.",
    experience: "Thanks for applying. At this stage we need deeper experience for this role.",
    other: "Thanks for applying. We are moving forward with another direction right now.",
};

export default function ApplicationReviewModal({
    isOpen,
    onClose,
    onConfirm,
    mode,
    applicantName,
    roleTitle,
}: ApplicationReviewModalProps) {
    const [message, setMessage] = useState("");
    const [reason, setReason] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const isAccept = mode === "accept";

    const handleSubmit = async () => {
        if (!isAccept && !reason) {
            toast.error("Please select a reason for rejection");
            return;
        }

        setIsSubmitting(true);
        try {
            await onConfirm(message, reason);
            onClose();
            setMessage("");
            setReason("");
        } catch {
            toast.error("An error occurred");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 animate-in fade-in duration-200" />
                <Dialog.Content className="fixed left-[50%] top-[50%] z-50 w-full max-w-md translate-x-[-50%] translate-y-[-50%] rounded-2xl bg-white dark:bg-zinc-900 shadow-xl border border-zinc-200 dark:border-zinc-800 focus:outline-none animate-in fade-in zoom-in-95 duration-200 overflow-hidden">
                    
                    <div className={cn(
                        "px-6 py-4 border-b flex items-center gap-3",
                        isAccept 
                            ? "bg-purple-50 dark:bg-purple-900/20 border-purple-100 dark:border-purple-800" 
                            : "bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-800"
                    )}>
                        <div className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0",
                            isAccept 
                                ? "bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-400" 
                                : "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400"
                        )}>
                            {isAccept ? <Check className="w-5 h-5" /> : <X className="w-5 h-5" />}
                        </div>
                        <div>
                            <Dialog.Title className={cn(
                                "text-lg font-bold",
                                isAccept ? "text-purple-900 dark:text-purple-100" : "text-red-900 dark:text-red-100"
                            )}>
                                {isAccept ? "Accept Applicant" : "Reject Application"}
                            </Dialog.Title>
                            <p className={cn(
                                "text-xs font-medium",
                                isAccept ? "text-purple-700 dark:text-purple-300" : "text-red-700 dark:text-red-300"
                            )}>
                                {applicantName} • {roleTitle}
                            </p>
                        </div>
                    </div>

                    <div className="p-6 space-y-5">
                        {!isAccept && (
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                    Rejection Reason <span className="text-red-500">*</span>
                                </label>
                                <div className="relative">
                                    <select
                                        value={reason}
                                        onChange={(e) => {
                                            const next = e.target.value;
                                            setReason(next);
                                            if (!message.trim() && REJECTION_REASON_TEMPLATES[next]) {
                                                setMessage(REJECTION_REASON_TEMPLATES[next]);
                                            }
                                        }}
                                        className="w-full px-4 py-2.5 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm appearance-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
                                    >
                                        <option value="" disabled>Select a reason...</option>
                                        {REJECTION_REASONS.map(r => (
                                            <option key={r.value} value={r.value}>{r.label}</option>
                                        ))}
                                    </select>
                                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
                                </div>
                            </div>
                        )}

                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center justify-between">
                                {isAccept ? "Welcome Message (Optional)" : "Feedback Message (Optional)"}
                                <span className="text-xs font-normal text-zinc-400">Sent via DM</span>
                            </label>
                            <div className="relative">
                                <textarea
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                    placeholder={isAccept 
                                        ? "Hey! Excited to have you on the team..." 
                                        : "Thank you for your interest. Unfortunately..."
                                    }
                                    className="w-full h-32 px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm resize-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors placeholder:text-zinc-400"
                                />
                                <MessageSquare className="absolute right-3 bottom-3 w-4 h-4 text-zinc-300 dark:text-zinc-600" />
                            </div>
                        </div>

                        {isAccept && (
                            <div className="p-3 bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/20 rounded-xl flex gap-3 text-sm text-blue-700 dark:text-blue-300">
                                <Briefcase className="w-5 h-5 flex-shrink-0" />
                                <p className="text-xs leading-relaxed">
                                    Accepting this applicant will automatically add them to the <strong>{roleTitle}</strong> role and grant them member access to the project workspace.
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="px-6 py-4 bg-zinc-50 dark:bg-zinc-800/50 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-3">
                        <button
                            onClick={onClose}
                            disabled={isSubmitting}
                            className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={isSubmitting}
                            className={cn(
                                "px-4 py-2 text-sm font-bold text-white rounded-lg shadow-sm transition-all flex items-center gap-2",
                                isAccept
                                    ? "bg-purple-600 hover:bg-purple-700"
                                    : "bg-red-600 hover:bg-red-700"
                            )}
                        >
                            {isSubmitting ? (
                                <>Processing...</>
                            ) : (
                                <>
                                    {isAccept ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                                    {isAccept ? "Confirm Acceptance" : "Reject Application"}
                                </>
                            )}
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
