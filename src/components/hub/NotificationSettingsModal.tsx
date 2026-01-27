'use client';

interface NotificationSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function NotificationSettingsModal({
    isOpen,
    onClose,
}: NotificationSettingsModalProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
            <div className="relative bg-white dark:bg-zinc-900 rounded-2xl shadow-xl p-6 max-w-md w-full">
                <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-4">
                    Notification Settings
                </h2>
                <p className="text-zinc-500 dark:text-zinc-400">
                    Notification settings coming soon.
                </p>
                <button
                    onClick={onClose}
                    className="mt-4 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                >
                    Close
                </button>
            </div>
        </div>
    );
}
