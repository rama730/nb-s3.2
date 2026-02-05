'use client';

import { WIZARD_PHASES } from '@/constants/project-wizard';

interface WizardHeaderProps {
    currentPhase: number;
}

export default function WizardHeader({ currentPhase }: WizardHeaderProps) {
    return (
        <div className="px-8 py-6 border-b border-zinc-100 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-xl">
            <div className="flex items-center justify-between max-w-5xl mx-auto">
                <div className="flex items-center gap-4 w-full justify-center">
                    {WIZARD_PHASES.map((phase, index) => {
                        const isCompleted = currentPhase > phase.id;
                        const isCurrent = currentPhase === phase.id;

                        return (
                            <div key={phase.id} className="flex items-center">
                                <div className="flex flex-col items-center gap-1.5 min-w-[60px]">
                                    <div 
                                        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                                            isCurrent
                                                ? 'bg-indigo-600 text-white ring-4 ring-indigo-100 dark:ring-indigo-900/30 scale-110'
                                                : isCompleted
                                                ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400'
                                                : 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500'
                                        }`}
                                    >
                                        {isCompleted ? '✓' : phase.id}
                                    </div>
                                    <span className={`text-[10px] font-bold uppercase tracking-wider ${
                                        isCurrent ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-400'
                                    }`}>
                                        {phase.label}
                                    </span>
                                </div>
                                {index < WIZARD_PHASES.length - 1 && (
                                    <div className={`w-8 h-[2px] mb-4 mx-2 transition-colors duration-500 ${
                                        isCompleted ? 'bg-indigo-200 dark:bg-indigo-900' : 'bg-zinc-100 dark:bg-zinc-800'
                                    }`} />
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
