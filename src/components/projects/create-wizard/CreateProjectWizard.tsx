'use client';

import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FormProvider } from 'react-hook-form';
import { X, AlertCircle, Save } from 'lucide-react';
import dynamic from 'next/dynamic';

import { TOTAL_PHASES } from '@/constants/project-wizard';

// Hook
import { useCreateProjectWizard } from './useCreateProjectWizard';

// Shared Components
import WizardHeader from './WizardHeader';
import WizardFooter from './WizardFooter';
import { useReducedMotionPreference } from '@/components/providers/theme-provider';

// Dynamic Phase Imports with Consistent Loading States
const PhaseLoadingPlaceholder = () => (
    <div className="min-h-[300px] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-zinc-400">Loading...</span>
        </div>
    </div>
);

const Phase1SourceSelection = dynamic(() => import('./phases/Phase1SourceSelection'), { loading: PhaseLoadingPlaceholder, ssr: false });
const Phase1TypeSelection = dynamic(() => import('./phases/Phase1TypeSelection'), { loading: PhaseLoadingPlaceholder, ssr: false });
const Phase2Information = dynamic(() => import('./phases/Phase2Information'), { loading: PhaseLoadingPlaceholder, ssr: false });
const Phase3TeamRoles = dynamic(() => import('./phases/Phase3TeamRoles'), { loading: PhaseLoadingPlaceholder, ssr: false });
const Phase4Settings = dynamic(() => import('./phases/Phase4Settings'), { loading: PhaseLoadingPlaceholder, ssr: false });
const Phase5Review = dynamic(() => import('./phases/Phase5Review'), { loading: PhaseLoadingPlaceholder, ssr: false });

interface Props {
    onClose: () => void;
    onSuccess?: (projectId: string) => void;
    draftId?: string;
    initialSource?: 'scratch' | 'github' | 'upload' | null;
    onSourceChange?: (source: 'scratch' | 'github' | 'upload' | null) => void;
}

export default function CreateProjectWizard({ onClose, onSuccess, draftId, initialSource = null, onSourceChange }: Props) {
    const reduceMotion = useReducedMotionPreference();
    const {
        phase, methods, wizardContext, isSubmitting, isSavingDraft,
        uploadFiles, setUploadFiles, uploadProgress,
        githubPreview, githubFolderEntries, loadGithubFolder, startGithubRootPreview,
        saveStatus, lastSaved, showExitConfirm, setShowExitConfirm,
        handleNext, handleBack, goToPhase, saveDraft, handleCloseAttempt,
        onSubmit, draftInfo, restoreDraft, deleteDraft
    } = useCreateProjectWizard({ onClose, onSuccess, draftId });

    const { handleSubmit } = methods;

    const phase1NextLabel = (() => {
        if (phase !== 1) return undefined;
        const t = methods.getValues('import_source.type');
        if (t !== 'github') return undefined;
        const url = (methods.getValues('import_source.repoUrl') || '').trim();
        if (!url) return 'Continue';
        return 'Continue';
    })();

    const phase1NextDisabled = (() => {
        if (phase !== 1) return false;
        const t = methods.getValues('import_source.type');
        if (!t) {
            return true;
        }
        if (t === 'github') {
            const url = (methods.getValues('import_source.repoUrl') || '').trim();
            if (!url) return true;
            const metadata = (methods.getValues('import_source.metadata') || {}) as Record<string, unknown>;
            return metadata.githubPreflightStatus !== 'ok';
        }

        if (t === 'upload') {
            return !uploadFiles || uploadFiles.length === 0;
        }

        return false;
    })();

    // OPTIMIZATION: Prefetch next phase component to eliminate loading delay
    useEffect(() => {
        if (phase === 1) import('./phases/Phase1TypeSelection');
        else if (phase === 2) import('./phases/Phase2Information');
        else if (phase === 3) import('./phases/Phase3TeamRoles');
        else if (phase === 4) import('./phases/Phase4Settings');
        else if (phase === 5) import('./phases/Phase5Review');
    }, [phase]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            if (event.defaultPrevented) return;

            const target = event.target instanceof Element ? event.target : null;
            if (
                target instanceof HTMLInputElement
                || target instanceof HTMLTextAreaElement
                || target instanceof HTMLSelectElement
                || target?.closest('[contenteditable="true"]')
            ) {
                return;
            }

            const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
            const hasNestedEscapeHandler = path.some((node) => (
                node instanceof Element
                && node !== document.body
                && node !== document.documentElement
                && (
                    node.hasAttribute('data-escape-handled')
                    || node.getAttribute('role') === 'menu'
                    || node.getAttribute('role') === 'listbox'
                    || node.getAttribute('role') === 'alertdialog'
                    || node.hasAttribute('data-radix-popper-content-wrapper')
                )
            ));
            if (hasNestedEscapeHandler) return;

            event.preventDefault();
            if (showExitConfirm) {
                setShowExitConfirm(false);
                return;
            }
            handleCloseAttempt();
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [handleCloseAttempt, setShowExitConfirm, showExitConfirm]);

    return (
        <AnimatePresence initial={!reduceMotion}>
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6" role="dialog" aria-modal="true">
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={reduceMotion ? { duration: 0 } : undefined}
                    className="fixed inset-0 bg-black/40 backdrop-blur-sm"
                />

                <motion.div
                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 20 }}
                    animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 20 }}
                    transition={reduceMotion ? { duration: 0 } : undefined}
                    className="relative w-full max-w-5xl bg-white dark:bg-zinc-900 rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]"
                    onClick={(e) => e.stopPropagation()}
                >
                    <FormProvider {...methods}>
                        {/* Header */}
                        <div className="relative flex-shrink-0 border-b border-zinc-100 dark:border-zinc-800">
                            <button
                                type="button"
                                onClick={handleCloseAttempt}
                                aria-label="Close"
                                className="absolute right-4 top-4 z-10 p-1.5 text-zinc-400 hover:text-zinc-500 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 rounded-full transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                            <WizardHeader currentPhase={phase} />
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto px-6 py-6 scrollbar-thin scrollbar-thumb-zinc-200 dark:scrollbar-thumb-zinc-800">
                            {uploadProgress?.isUploading && (
                                <div className="mb-4 rounded-xl border border-primary/15 dark:border-primary/20 bg-primary/5 dark:bg-primary/10 p-4">
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="min-w-0">
                                            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                                Importing files…
                                            </div>
                                            <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                                                {uploadProgress.currentFile || 'Preparing uploads'}
                                            </div>
                                        </div>
                                        <div className="text-sm font-bold text-primary shrink-0 tabular-nums">
                                            {uploadProgress.percent}%
                                        </div>
                                    </div>
                                    <div className="mt-3 h-2 rounded-full bg-primary/10 dark:bg-primary/10 overflow-hidden">
                                        <div
                                            className="h-full bg-primary transition-all duration-200"
                                            style={{ width: `${uploadProgress.percent}%` }}
                                        />
                                    </div>
                                </div>
                            )}
                            <form
                                id="create-project-form"
                                onSubmit={handleSubmit(onSubmit as any)}
                                className="space-y-8"
                            >
                                <AnimatePresence mode="wait" initial={!reduceMotion}>
                                    <motion.div
                                        key={phase}
                                        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 20 }}
                                        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
                                        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -20 }}
                                        transition={reduceMotion ? { duration: 0 } : { duration: 0.2 }}
                                    >
                                        {phase === 1 && (
                                            <Phase1SourceSelection
                                                uploadFiles={uploadFiles}
                                                setUploadFiles={setUploadFiles}
                                                uploadProgress={uploadProgress}
                                                githubPreview={githubPreview}
                                                githubFolderEntries={githubFolderEntries}
                                                loadGithubFolder={loadGithubFolder}
                                                startGithubRootPreview={startGithubRootPreview}
                                                initialSource={initialSource}
                                                onSourceChange={onSourceChange}
                                            />
                                        )}
                                        {phase === 2 && <Phase1TypeSelection />}
                                        {phase === 3 && <Phase2Information />}
                                        {phase === 4 && <Phase3TeamRoles wizardContext={wizardContext} />}
                                        {phase === 5 && <Phase4Settings />}
                                        {phase === 6 && <Phase5Review wizardContext={wizardContext} goToPhase={goToPhase} />}
                                    </motion.div>
                                </AnimatePresence>
                            </form>
                        </div>

                        {/* Draft Recovery Banner */}
                        {draftInfo?.exists && (
                            <div className="flex-shrink-0 px-6 py-4 bg-indigo-50/50 dark:bg-indigo-900/20 border-t border-indigo-100 dark:border-indigo-800/30">
                                <div className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center flex-shrink-0">
                                            <Save className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-100 truncate">
                                                Resume Previous Draft?
                                            </p>
                                            <p className="text-xs text-indigo-600/80 dark:text-indigo-400/80">
                                                You were on Phase {draftInfo.phase} {draftInfo.savedAt ? `(${draftInfo.savedAt.toLocaleDateString()})` : ''}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        <button
                                            type="button"
                                            onClick={deleteDraft}
                                            className="px-4 py-2 text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors border border-transparent hover:border-red-100 dark:hover:border-red-800/50"
                                        >
                                            Delete draft
                                        </button>
                                        <button
                                            type="button"
                                            onClick={restoreDraft}
                                            className="px-5 py-2 text-xs font-bold app-accent-solid hover:bg-primary/90 rounded-lg transition-all shadow-md hover:shadow-lg active:scale-95"
                                        >
                                            Continue with the draft
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Footer */}
                        <div className="flex-shrink-0">
                            <WizardFooter
                                phase={phase}
                                totalPhases={6}
                                onNext={handleNext}
                                onBack={handleBack}
                                onSaveDraft={() => saveDraft()}
                                isSubmitting={isSubmitting}
                                isSavingDraft={isSavingDraft}
                                saveStatus={saveStatus}
                                lastSaved={lastSaved}
                                nextLabel={phase1NextLabel}
                                nextDisabled={phase1NextDisabled}
                            />
                        </div>
                    </FormProvider>

                    {/* Exit Confirmation Dialog */}
                    <AnimatePresence initial={!reduceMotion}>
                        {showExitConfirm && (
                            <div className="absolute inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                                <motion.div
                                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
                                    animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
                                    transition={reduceMotion ? { duration: 0 } : undefined}
                                    className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-xl shadow-2xl overflow-hidden border border-zinc-200 dark:border-zinc-700 p-6"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <div className="flex flex-col items-center text-center">
                                        <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-4">
                                            <AlertCircle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                                        </div>
                                        <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-2">
                                            Unsaved Changes
                                        </h3>
                                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
                                            You have unsaved changes. Are you sure you want to leave? Your progress will be lost.
                                        </p>
                                        <div className="flex gap-3 w-full">
                                            <button
                                                type="button"
                                                onClick={() => setShowExitConfirm(false)}
                                                className="flex-1 px-4 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                                            >
                                                Stay
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setShowExitConfirm(false);
                                                    onClose();
                                                }}
                                                className="flex-1 px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 transition-colors"
                                            >
                                                Leave
                                            </button>
                                        </div>
                                    </div>
                                </motion.div>
                            </div>
                        )}
                    </AnimatePresence>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
