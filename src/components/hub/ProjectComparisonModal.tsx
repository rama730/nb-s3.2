'use client';

import { Project } from '@/types/hub';

interface ProjectComparisonModalProps {
    projects: Project[];
    onClose: () => void;
}

export default function ProjectComparisonModal({
    projects,
    onClose,
}: ProjectComparisonModalProps) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
            <div className="relative bg-white dark:bg-zinc-900 rounded-2xl shadow-xl p-6 max-w-4xl w-full max-h-[80vh] overflow-y-auto">
                <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-4">
                    Compare Projects ({projects.length})
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {projects.map((project) => (
                        <div key={project.id} className="p-4 bg-zinc-50 dark:bg-zinc-800 rounded-xl">
                            <h3 className="font-bold text-zinc-900 dark:text-zinc-100 mb-2">
                                {project.title}
                            </h3>
                            <p className="text-sm text-zinc-500 dark:text-zinc-400 line-clamp-3">
                                {project.description || 'No description'}
                            </p>
                        </div>
                    ))}
                </div>
                <button
                    onClick={onClose}
                    className="mt-4 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg text-zinc-700 dark:text-zinc-300"
                >
                    Close
                </button>
            </div>
        </div>
    );
}
