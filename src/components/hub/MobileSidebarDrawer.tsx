'use client';

import { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useReducedMotionPreference } from '@/components/providers/theme-provider';

interface MobileSidebarDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    children: ReactNode;
}

export default function MobileSidebarDrawer({
    isOpen,
    onClose,
    children,
}: MobileSidebarDrawerProps) {
    const reduceMotion = useReducedMotionPreference();

    return (
        <AnimatePresence initial={!reduceMotion}>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={reduceMotion ? { duration: 0 } : undefined}
                        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 lg:hidden"
                        onClick={onClose}
                    />

                    {/* Drawer */}
                    <motion.div
                        initial={reduceMotion ? { opacity: 0 } : { x: '-100%' }}
                        animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
                        exit={reduceMotion ? { opacity: 0 } : { x: '-100%' }}
                        transition={reduceMotion ? { duration: 0 } : { type: 'spring', damping: 25, stiffness: 300 }}
                        className="fixed left-0 top-0 bottom-0 w-80 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 z-50 lg:hidden overflow-y-auto"
                    >
                        <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
                            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                                Filters & Collections
                            </h2>
                            <button
                                onClick={onClose}
                                className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-4">
                            {children}
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
