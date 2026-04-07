'use client';

import { useState } from 'react';
import { Flag, X } from 'lucide-react';
import { toast } from 'sonner';

const REPORT_REASONS = [
    { id: 'spam', label: 'Spam' },
    { id: 'harassment', label: 'Harassment' },
    { id: 'hate_speech', label: 'Hate speech' },
    { id: 'inappropriate', label: 'Inappropriate content' },
    { id: 'other', label: 'Other' },
] as const;

interface ReportMessageDialogProps {
    messageId: string;
    isOpen: boolean;
    onClose: () => void;
}

export function ReportMessageDialog({ messageId, isOpen, onClose }: ReportMessageDialogProps) {
    const [reason, setReason] = useState<string>('');
    const [details, setDetails] = useState('');
    const [submitting, setSubmitting] = useState(false);

    if (!isOpen) return null;

    const handleSubmit = async () => {
        if (!reason) {
            toast.error('Please select a reason');
            return;
        }
        setSubmitting(true);
        try {
            const { reportMessage: reportMessageAction } = await import('@/app/actions/messaging/features');
            const result = await reportMessageAction(messageId, reason as 'spam' | 'harassment' | 'hate_speech' | 'inappropriate' | 'other', details || undefined);
            if (!result.success) {
                toast.error(result.error || 'Failed to submit report');
                return;
            }
            toast.success('Report submitted. We\'ll review it shortly.');
            onClose();
            setReason('');
            setDetails('');
        } catch {
            toast.error('Failed to submit report');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-zinc-900">
                <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Flag className="h-5 w-5 text-red-500" />
                        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Report this message</h3>
                    </div>
                    <button type="button" onClick={onClose} className="rounded-full p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Close">
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="space-y-2">
                    {REPORT_REASONS.map((r) => (
                        <label key={r.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                            reason === r.id ? 'border-primary bg-primary/5' : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800'
                        }`}>
                            <input
                                type="radio"
                                name="report-reason"
                                value={r.id}
                                checked={reason === r.id}
                                onChange={() => setReason(r.id)}
                                className="accent-primary"
                            />
                            <span className="text-sm text-zinc-900 dark:text-zinc-100">{r.label}</span>
                        </label>
                    ))}
                </div>
                <textarea
                    value={details}
                    onChange={(e) => setDetails(e.target.value)}
                    placeholder="Add details (optional)"
                    rows={3}
                    className="mt-3 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 dark:border-zinc-700 dark:bg-zinc-800"
                />
                <div className="mt-4 flex justify-end gap-2">
                    <button type="button" onClick={onClose} disabled={submitting} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                        Cancel
                    </button>
                    <button type="button" onClick={() => void handleSubmit()} disabled={submitting || !reason} className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50">
                        {submitting ? 'Submitting...' : 'Submit Report'}
                    </button>
                </div>
            </div>
        </div>
    );
}
