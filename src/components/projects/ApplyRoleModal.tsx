"use client";

import React, { useState, useCallback, useMemo, useEffect } from "react";
import { X, Send, Users, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { applyToRoleAction } from "@/app/actions/applications";
import { useChatStore } from "@/stores/chatStore";
import Link from "next/link";

interface Role {
    id: string;
    role: string;
    title?: string;
    description?: string;
    count: number;
    filled: number;
}

interface ApplyRoleModalProps {
    isOpen: boolean;
    onClose: () => void;
    project: {
        id: string;
        title: string;
        slug?: string;
    };
    roles: Role[];
    preselectedRoleId?: string;
    onSuccess?: () => void;
}

export default function ApplyRoleModal({
    isOpen,
    onClose,
    project,
    roles,
    preselectedRoleId,
    onSuccess,
}: ApplyRoleModalProps) {
    const [selectedRoleId, setSelectedRoleId] = useState<string>("");
    const [message, setMessage] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    // OPTIMIZATION: Reset state when modal opens and sync preselectedRoleId
    useEffect(() => {
        if (isOpen) {
            // Reset message on open
            setMessage("");
            // Set initial role selection
            setSelectedRoleId(preselectedRoleId || roles[0]?.id || "");
        }
    }, [isOpen, preselectedRoleId, roles]);

    const selectedRole = useMemo(
        () => roles.find((r) => r.id === selectedRoleId),
        [roles, selectedRoleId]
    );

    const handleSubmit = useCallback(async () => {
        if (!selectedRoleId) {
            toast.error("Please select a role");
            return;
        }
        if (!message.trim()) {
            toast.error("Please write a message");
            return;
        }

        setIsSubmitting(true);
        try {
            const result = await applyToRoleAction(project.id, selectedRoleId, message.trim());
            if (result.success) {
                toast.success("Application sent successfully!");
                if (result.conversationId) {
                    useChatStore.getState().refreshMessages(result.conversationId);
                    useChatStore.getState().checkActiveConnectionStatus();
                    // REFRESH APPLICATIONS LIST (FORCE UPDATE)
                    useChatStore.getState().fetchApplications(true);
                }
                onSuccess?.();
                onClose();
            } else {
                toast.error(result.error || "Failed to send application");
            }
        } catch (error) {
            toast.error("Something went wrong");
        } finally {
            setIsSubmitting(false);
        }
    }, [selectedRoleId, message, project.id, onSuccess, onClose]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative z-10 w-full max-w-lg mx-4 bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-zinc-200 dark:border-zinc-800">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
                            <Send className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                                Apply to Join
                            </h2>
                            <p className="text-sm text-zinc-500">
                                <Link
                                    href={`/projects/${project.slug || project.id}`}
                                    className="text-indigo-600 dark:text-indigo-400 hover:underline"
                                >
                                    {project.title}
                                </Link>
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    >
                        <X className="w-5 h-5 text-zinc-500" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-5 space-y-5">
                    {/* Role Selection */}
                    <div>
                        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-3">
                            Select a Role
                        </label>
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                            {roles.map((role) => {
                                const available = role.count - role.filled;
                                const isFull = available <= 0;
                                const isSelected = selectedRoleId === role.id;

                                return (
                                    <label
                                        key={role.id}
                                        className={`
                                            flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all
                                            ${isSelected
                                                ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20"
                                                : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600"
                                            }
                                            ${isFull ? "opacity-50 cursor-not-allowed" : ""}
                                        `}
                                    >
                                        <input
                                            type="radio"
                                            name="role"
                                            value={role.id}
                                            checked={isSelected}
                                            onChange={() => !isFull && setSelectedRoleId(role.id)}
                                            disabled={isFull}
                                            className="sr-only"
                                        />
                                        <div
                                            className={`
                                                w-5 h-5 rounded-full border-2 flex items-center justify-center
                                                ${isSelected
                                                    ? "border-indigo-500 bg-indigo-500"
                                                    : "border-zinc-300 dark:border-zinc-600"
                                                }
                                            `}
                                        >
                                            {isSelected && (
                                                <CheckCircle2 className="w-3 h-3 text-white" />
                                            )}
                                        </div>
                                        <div className="flex-1">
                                            <p className="font-medium text-zinc-900 dark:text-zinc-100">
                                                {role.title || role.role}
                                            </p>
                                            {role.description && (
                                                <p className="text-xs text-zinc-500 line-clamp-1">
                                                    {role.description}
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1 text-xs text-zinc-500">
                                            <Users className="w-3.5 h-3.5" />
                                            <span>
                                                {role.filled}/{role.count}
                                            </span>
                                            {isFull && (
                                                <span className="text-rose-500 ml-1">Full</span>
                                            )}
                                        </div>
                                    </label>
                                );
                            })}
                        </div>
                    </div>

                    {/* Message */}
                    <div>
                        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                            Message to Project Lead
                        </label>
                        <textarea
                            value={message}
                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setMessage(e.target.value)}
                            placeholder="Hi! I'd love to contribute to this project. I have experience in..."
                            className="w-full min-h-[100px] p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            maxLength={500}
                        />
                        <p className="text-xs text-zinc-400 mt-1 text-right">
                            {message.length}/500
                        </p>
                    </div>

                    {/* Preview */}
                    {selectedRole && message.trim() && (
                        <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-4">
                            <p className="text-xs text-zinc-500 mb-2">Preview:</p>
                            <div className="text-sm">
                                <span className="text-indigo-600 dark:text-indigo-400 font-medium">
                                    🔗 {project.title}
                                </span>
                                <span className="text-zinc-400 mx-1">/</span>
                                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                                    {selectedRole.title || selectedRole.role}
                                </span>
                                <p className="mt-2 text-zinc-600 dark:text-zinc-400">
                                    {message.trim()}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Info */}
                    <p className="text-xs text-zinc-500 text-center">
                        ℹ️ You can only apply once per project
                    </p>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 p-5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/30">
                    <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={isSubmitting || !selectedRoleId || !message.trim()}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white"
                    >
                        {isSubmitting ? "Sending..." : "Send Application"}
                    </Button>
                </div>
            </div>
        </div>
    );
}
