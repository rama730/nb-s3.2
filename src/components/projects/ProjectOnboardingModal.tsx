"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Rocket, FileText } from "lucide-react";
import { useEffect, useRef } from "react";
import confetti from "canvas-confetti";

interface ProjectOnboardingModalProps {
    isOpen: boolean;
    onClose: () => void;
    projectTitle: string;
    roleTitle?: string;
    onViewTasks: () => void;
    onViewDocs: () => void;
}

export function ProjectOnboardingModal({
    isOpen,
    onClose,
    projectTitle,
    roleTitle,
    onViewTasks,
    onViewDocs
}: ProjectOnboardingModalProps) {
    const confettiFiredRef = useRef(false);

    useEffect(() => {
        if (!isOpen) {
            confettiFiredRef.current = false;
            return;
        }
        if (confettiFiredRef.current) return;
        confettiFiredRef.current = true;
        const timeoutId = window.setTimeout(() => {
            confetti({
                particleCount: 100,
                spread: 70,
                origin: { y: 0.6 },
                zIndex: 9999,
            });
        }, 300);
        return () => {
            window.clearTimeout(timeoutId);
            confettiFiredRef.current = false;
        };
    }, [isOpen]);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[500px] p-0 overflow-hidden bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800">
                <div className="h-2 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
                
                <div className="p-6">
                    <DialogHeader>
                        <div className="mx-auto w-12 h-12 bg-indigo-100 dark:bg-indigo-900/50 rounded-full flex items-center justify-center mb-4">
                            <Rocket className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <DialogTitle className="text-center text-xl font-bold">
                            Welcome to the Team!
                        </DialogTitle>
                        <DialogDescription className="text-center text-zinc-500 dark:text-zinc-400 mt-2">
                            You are now an official member of <span className="font-semibold text-zinc-900 dark:text-zinc-100">{projectTitle}</span>
                            {roleTitle && <span> as a <span className="font-semibold text-indigo-600 dark:text-indigo-400">{roleTitle}</span></span>}.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="mt-8 space-y-4">
                        <div className="p-4 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-zinc-100 dark:border-zinc-800 flex gap-3">
                            <div className="mt-1">
                                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                            </div>
                            <div>
                                <h4 className="font-medium text-sm text-zinc-900 dark:text-zinc-100">Access Granted</h4>
                                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                                    You can now view internal documents, tasks, and sprint boards.
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <button 
                                onClick={onViewTasks}
                                className="p-4 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-xl transition-all hover:scale-[1.02] text-left group"
                            >
                                <div className="w-8 h-8 bg-blue-50 dark:bg-blue-900/20 rounded-lg flex items-center justify-center mb-3 group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30 transition-colors">
                                    <CheckCircle2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                </div>
                                <span className="font-semibold text-sm block">My Tasks</span>
                                <span className="text-xs text-zinc-500">View your assignments</span>
                            </button>

                            <button 
                                onClick={onViewDocs}
                                className="p-4 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-xl transition-all hover:scale-[1.02] text-left group"
                            >
                                <div className="w-8 h-8 bg-amber-50 dark:bg-amber-900/20 rounded-lg flex items-center justify-center mb-3 group-hover:bg-amber-100 dark:group-hover:bg-amber-900/30 transition-colors">
                                    <FileText className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                                </div>
                                <span className="font-semibold text-sm block">Read Docs</span>
                                <span className="text-xs text-zinc-500">Get up to speed</span>
                            </button>
                        </div>
                    </div>
                </div>

                <DialogFooter className="p-4 bg-zinc-50 dark:bg-zinc-900/50 border-t border-zinc-100 dark:border-zinc-800 sm:justify-center">
                    <Button onClick={onClose} variant="ghost" size="sm" className="text-zinc-500">
                        Dismiss
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
