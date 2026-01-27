'use client';

import { Project } from '@/types/hub';
import { X, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ProjectQuickViewProps {
    project: Project | null;
    isOpen: boolean;
    onClose: () => void;
    onNext?: () => void;
    onPrevious?: () => void;
    hasNext?: boolean;
    hasPrevious?: boolean;
}

export default function ProjectQuickView({
    project,
    isOpen,
    onClose,
    onNext,
    onPrevious,
    hasNext,
    hasPrevious,
}: ProjectQuickViewProps) {
    if (!project || !isOpen) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                {/* Backdrop */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm"
                    onClick={onClose}
                />

                {/* Navigation Arrows */}
                {hasPrevious && (
                    <button
                        onClick={onPrevious}
                        className="absolute left-4 z-10 p-3 bg-white/90 dark:bg-zinc-800/90 rounded-full shadow-lg hover:bg-white dark:hover:bg-zinc-700 transition-colors"
                    >
                        <ChevronLeft className="w-6 h-6" />
                    </button>
                )}
                {hasNext && (
                    <button
                        onClick={onNext}
                        className="absolute right-4 z-10 p-3 bg-white/90 dark:bg-zinc-800/90 rounded-full shadow-lg hover:bg-white dark:hover:bg-zinc-700 transition-colors"
                    >
                        <ChevronRight className="w-6 h-6" />
                    </button>
                )}

                {/* Modal */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="relative bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-6 border-b border-zinc-200 dark:border-zinc-800">
                        <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                            {project.title}
                        </h2>
                        <button
                            onClick={onClose}
                            className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="p-6 overflow-y-auto max-h-[calc(80vh-140px)]">
                        <p className="text-zinc-600 dark:text-zinc-400 mb-6">
                            {project.description || project.short_description || 'No description available.'}
                        </p>

                        {/* Tech Stack */}
                        {project.technologies_used && project.technologies_used.length > 0 && (
                            <div className="mb-6">
                                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                                    Technologies
                                </h3>
                                <div className="flex flex-wrap gap-2">
                                    {project.technologies_used.map((tech) => (
                                        <span
                                            key={tech}
                                            className="px-3 py-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-lg text-sm"
                                        >
                                            {tech}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-end gap-3 p-6 border-t border-zinc-200 dark:border-zinc-800">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                        >
                            Close
                        </button>
                        <a
                            href={`/projects/${project.slug || project.id}`}
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
                        >
                            View Project
                            <ExternalLink className="w-4 h-4" />
                        </a>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
