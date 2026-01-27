'use client';

import { motion } from 'framer-motion';
import { Check } from 'lucide-react';

interface WizardHeaderProps {
    currentPhase: number;
    totalPhases: number;
}

const PHASE_LABELS = ['Type', 'Info', 'Team', 'Settings', 'Review'];

export default function WizardHeader({ currentPhase, totalPhases }: WizardHeaderProps) {
    return (
        <div className="w-full py-4 mb-2">
            <div className="flex items-start justify-between">
                {Array.from({ length: totalPhases }, (_, i) => i + 1).map((step, index) => {
                    const isCompleted = step < currentPhase;
                    const isCurrent = step === currentPhase;
                    const isLast = index === totalPhases - 1;

                    return (
                        <div key={step} className="flex items-start flex-1 last:flex-none">
                            {/* Step with Label */}
                            <div className="flex flex-col items-center">
                                {/* Label on TOP */}
                                <span className={`text-[11px] font-medium mb-2.5 whitespace-nowrap transition-colors duration-300 ${isCompleted
                                        ? 'text-indigo-600 dark:text-indigo-400'
                                        : isCurrent
                                            ? 'text-indigo-600 dark:text-indigo-400 font-semibold'
                                            : 'text-zinc-400 dark:text-zinc-500'
                                    }`}>
                                    {PHASE_LABELS[index]}
                                </span>

                                {/* Step Circle */}
                                <motion.div
                                    initial={false}
                                    animate={{
                                        scale: isCurrent ? 1 : 1,
                                        boxShadow: isCurrent
                                            ? '0 0 0 4px rgba(99, 102, 241, 0.2)'
                                            : '0 0 0 0px rgba(99, 102, 241, 0)',
                                    }}
                                    transition={{
                                        type: 'spring',
                                        stiffness: 300,
                                        damping: 20
                                    }}
                                    className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-colors duration-300 ${isCompleted
                                            ? 'bg-indigo-500 text-white'
                                            : isCurrent
                                                ? 'bg-indigo-500 text-white'
                                                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 border-2 border-zinc-200 dark:border-zinc-700'
                                        }`}
                                >
                                    {isCompleted ? (
                                        <motion.div
                                            initial={{ scale: 0 }}
                                            animate={{ scale: 1 }}
                                            transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                                        >
                                            <Check className="w-4 h-4" strokeWidth={3} />
                                        </motion.div>
                                    ) : (
                                        step
                                    )}
                                </motion.div>
                            </div>

                            {/* Connector Line (not for last item) */}
                            {!isLast && (
                                <div className="flex-1 flex items-center h-9 mt-[34px]">
                                    <div className="relative w-full h-[3px] mx-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                                        <motion.div
                                            className="absolute inset-y-0 left-0 bg-indigo-500 rounded-full"
                                            initial={false}
                                            animate={{
                                                width: isCompleted ? '100%' : '0%',
                                            }}
                                            transition={{
                                                type: 'spring',
                                                stiffness: 150,
                                                damping: 20,
                                                mass: 0.8,
                                            }}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
