'use client';

import { Project } from '@/types/hub';
import { X, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useReducedMotionPreference } from '@/components/providers/theme-provider';

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
    const reduceMotion = useReducedMotionPreference();
    if (!project || !isOpen) return null;
    const availableRoles =
        project.openRoles?.filter(
            (role) => Math.max(0, (role.count || 0) - (role.filled || 0)) > 0
        ) ?? [];

    return (
        <AnimatePresence initial={!reduceMotion}>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                {/* Backdrop */}
                <motion.div
                    initial={reduceMotion ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
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
                    initial={reduceMotion ? false : { opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={reduceMotion ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.95 }}
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
                        <p className="text-zinc-600 dark:text-zinc-400 mb-6 whitespace-pre-wrap">
                            {project.description || project.shortDescription || 'No description available.'}
                        </p>

                        {/* Open Roles */}
                        {availableRoles.length > 0 && (
                            <div className="mb-6">
                                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">
                                    Open Roles
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {availableRoles.map((role) => {
                                        const available = Math.max(0, (role.count || 0) - (role.filled || 0));
                                        return (
                                            <div
                                                key={role.id}
                                                className="p-3 rounded-xl border border-primary/15 bg-primary/10 dark:bg-primary/12 flex flex-col gap-1.5"
                                            >
                                                <div className="flex items-start justify-between gap-2">
                                                    <span className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm">
                                                        {role.title || role.role}
                                                    </span>
                                                    <span className="px-2 py-0.5 rounded-md bg-primary/15 text-primary text-[10px] font-bold">
                                                        {available} Open
                                                    </span>
                                                </div>
                                                {role.skills && role.skills.length > 0 && (
                                                    <div className="flex flex-wrap gap-1 mt-1">
                                                        {role.skills.map((skill) => (
                                                            <span key={skill} className="text-[10px] px-1.5 py-0.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-zinc-500 dark:text-zinc-400">
                                                                {skill}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Tech Stack */}
                        {project.skills && project.skills.length > 0 && (
                            <div className="mb-6">
                                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                                    Technologies
                                </h3>
                                <div className="flex flex-wrap gap-2">
                                    {project.skills.map((tech) => (
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
                            className="flex items-center gap-2 px-4 py-2 app-accent-solid hover:bg-primary/90 rounded-lg transition-[background-color,box-shadow]"
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
