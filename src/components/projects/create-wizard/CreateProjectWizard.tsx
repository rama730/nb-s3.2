'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { FormProvider } from 'react-hook-form';
import { X, Sparkles, AlertCircle } from 'lucide-react';
import dynamic from 'next/dynamic';

// Hook
import { useCreateProjectWizard } from './useCreateProjectWizard';

// Shared Components
import WizardHeader from './WizardHeader';
import WizardFooter from './WizardFooter';

// Dynamic Phase Imports for Performance
const Phase1TypeSelection = dynamic(() => import('./phases/Phase1TypeSelection'), {
    loading: () => <div className="h-64 flex items-center justify-center text-zinc-500">Loading...</div>,
});
const Phase2Information = dynamic(() => import('./phases/Phase2Information'));
const Phase3TeamRoles = dynamic(() => import('./phases/Phase3TeamRoles'));
const Phase4Settings = dynamic(() => import('./phases/Phase4Settings'));
const Phase5Review = dynamic(() => import('./phases/Phase5Review'));

const PHASE_TITLES = [
    'Select Project Type',
    'Project Information',
    'Team & Roles',
    'Settings & Terms',
    'Review & Launch',
];

interface Props {
    onClose: () => void;
    onSuccess?: (projectId: string) => void;
    draftId?: string;
}

export default function CreateProjectWizard({ onClose, onSuccess, draftId }: Props) {
    const {
        phase,
        methods,
        wizardContext,
        isSubmitting,
        isSavingDraft,
        saveStatus,
        lastSaved,
        showExitConfirm,
        setShowExitConfirm,
        handleNext,
        handleBack,
        goToPhase,
        saveDraft,
        handleCloseAttempt,
        onSubmit,
    } = useCreateProjectWizard({ onClose, onSuccess, draftId });

    const { handleSubmit } = methods;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6" role="dialog" aria-modal="true">
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 bg-black/40 backdrop-blur-sm"
                    onClick={handleCloseAttempt}
                />

                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="relative w-full max-w-5xl bg-white dark:bg-zinc-900 rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]"
                    onClick={(e) => e.stopPropagation()}
                >
                    <FormProvider {...methods}>
                        {/* Header */}
                        <div className="flex-shrink-0 px-6 pt-4 pb-2 border-b border-zinc-100 dark:border-zinc-800">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center">
                                        <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                                            Create New Project
                                        </h2>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                            {PHASE_TITLES[phase - 1]}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleCloseAttempt}
                                    aria-label="Close"
                                    className="p-1.5 -mr-2 text-zinc-400 hover:text-zinc-500 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 rounded-full transition-colors"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>

                            <WizardHeader currentPhase={phase} totalPhases={5} />
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto px-6 py-6 scrollbar-thin scrollbar-thumb-zinc-200 dark:scrollbar-thumb-zinc-800">
                            <form
                                id="create-project-form"
                                onSubmit={handleSubmit(onSubmit as unknown as Parameters<typeof handleSubmit>[0])}
                                className="space-y-8"
                            >
                                <AnimatePresence mode="wait">
                                    <motion.div
                                        key={phase}
                                        initial={{ opacity: 0, x: 20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -20 }}
                                        transition={{ duration: 0.2 }}
                                    >
                                        {phase === 1 && <Phase1TypeSelection />}
                                        {phase === 2 && <Phase2Information />}
                                        {phase === 3 && <Phase3TeamRoles wizardContext={wizardContext} />}
                                        {phase === 4 && <Phase4Settings />}
                                        {phase === 5 && <Phase5Review wizardContext={wizardContext} goToPhase={goToPhase} />}
                                    </motion.div>
                                </AnimatePresence>
                            </form>
                        </div>

                        {/* Footer */}
                        <div className="flex-shrink-0">
                            <WizardFooter
                                phase={phase}
                                totalPhases={5}
                                onNext={handleNext}
                                onBack={handleBack}
                                onSaveDraft={() => saveDraft()}
                                isSubmitting={isSubmitting}
                                isSavingDraft={isSavingDraft}
                                saveStatus={saveStatus}
                                lastSaved={lastSaved}
                            />
                        </div>
                    </FormProvider>

                    {/* Exit Confirmation Dialog */}
                    <AnimatePresence>
                        {showExitConfirm && (
                            <div className="absolute inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
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
