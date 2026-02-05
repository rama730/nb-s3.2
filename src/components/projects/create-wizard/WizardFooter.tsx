'use client';

import { ChevronLeft, ChevronRight, Save, Rocket, Loader2, Check } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface WizardFooterProps {
    phase: number;
    totalPhases: number;
    onNext: () => void;
    onBack: () => void;
    onSaveDraft: () => void;
    isSubmitting: boolean;
    isSavingDraft: boolean;
    saveStatus: 'idle' | 'saving' | 'saved' | 'error';
    lastSaved: Date | null;
    nextLabel?: string;
    nextDisabled?: boolean;
}

export default function WizardFooter({
    phase,
    totalPhases,
    onNext,
    onBack,
    onSaveDraft,
    isSubmitting,
    isSavingDraft,
    saveStatus,
    lastSaved,
    nextLabel,
    nextDisabled,
}: WizardFooterProps) {
    const isLastPhase = phase === totalPhases;

    return (
        <div className="px-6 py-4 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
            {/* Left: Back Button */}
            <div className="flex items-center gap-3">
                {phase > 1 && (
                    <button
                        type="button"
                        onClick={onBack}
                        className="flex items-center gap-2 px-4 py-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                    >
                        <ChevronLeft className="w-4 h-4" />
                        Back
                    </button>
                )}
            </div>

            {/* Center: Save Status */}
            <div className="flex items-center gap-2 text-sm text-zinc-400">
                {saveStatus === 'saving' && (
                    <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Saving...</span>
                    </>
                )}
                {saveStatus === 'saved' && (
                    <>
                        <Check className="w-4 h-4 text-green-500" />
                        <span className="text-green-500">Saved</span>
                    </>
                )}
                {saveStatus === 'idle' && lastSaved && (
                    <span>Last saved {formatDistanceToNow(lastSaved)} ago</span>
                )}
            </div>

            {/* Right: Save Draft + Next/Submit */}
            <div className="flex items-center gap-3">
                <button
                    type="button"
                    onClick={onSaveDraft}
                    disabled={isSavingDraft}
                    className="flex items-center gap-2 px-4 py-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-50"
                >
                    <Save className="w-4 h-4" />
                    <span className="hidden sm:inline">Save Draft</span>
                </button>

                {isLastPhase ? (
                    <button
                        type="submit"
                        form="create-project-form"
                        disabled={isSubmitting}
                        className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-xl font-medium transition-colors"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Creating...
                            </>
                        ) : (
                            <>
                                <Rocket className="w-4 h-4" />
                                Launch Project
                            </>
                        )}
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={onNext}
                        disabled={!!nextDisabled}
                        className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 disabled:opacity-60 text-white rounded-xl font-medium transition-colors"
                    >
                        {nextLabel || 'Continue'}
                        <ChevronRight className="w-4 h-4" />
                    </button>
                )}
            </div>
        </div>
    );
}
