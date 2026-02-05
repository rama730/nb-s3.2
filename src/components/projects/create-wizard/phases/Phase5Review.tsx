'use client';

import { useFormContext } from 'react-hook-form';
import { CreateProjectInput } from '@/lib/validations/project';
import { WizardContextType } from '../useCreateProjectWizard';
import { Edit3, Globe, Lock, Link2, Users, Tag } from 'lucide-react';

interface Phase5ReviewProps {
    wizardContext: WizardContextType;
    goToPhase: (phase: 1 | 2 | 3 | 4 | 5) => void;
}

export default function Phase5Review({ wizardContext, goToPhase }: Phase5ReviewProps) {
    const { watch } = useFormContext<CreateProjectInput>();
    const formData = watch();
    const { openRoles } = wizardContext;

    const visibilityIcons = {
        public: Globe,
        unlisted: Link2,
        private: Lock,
    };
    const VisibilityIcon = visibilityIcons[formData.visibility || 'public'];

    return (
        <div className="space-y-6">
            <div className="text-center mb-8">
                <h3 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">
                    Review Your Project
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Make sure everything looks good before launching
                </p>
            </div>

            {/* Project Info Section */}
            <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                    <h4 className="font-semibold text-zinc-900 dark:text-zinc-100">Project Details</h4>
                    <button
                        type="button"
                        onClick={() => goToPhase(2)}
                        className="flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700"
                    >
                        <Edit3 className="w-3 h-3" />
                        Edit
                    </button>
                </div>

                <div className="space-y-4">
                    <div>
                        <span className="text-sm text-zinc-500 dark:text-zinc-400">Title</span>
                        <p className="font-medium text-zinc-900 dark:text-zinc-100">{formData.title || '—'}</p>
                    </div>

                    {formData.short_description && (
                        <div>
                            <span className="text-sm text-zinc-500 dark:text-zinc-400">Tagline</span>
                            <p className="text-zinc-700 dark:text-zinc-300">{formData.short_description}</p>
                        </div>
                    )}

                    <div>
                        <span className="text-sm text-zinc-500 dark:text-zinc-400">Description</span>
                        <p className="text-zinc-700 dark:text-zinc-300 line-clamp-3">{formData.description || '—'}</p>
                    </div>

                    {(formData.problem_statement || formData.solution_overview) && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                            {formData.problem_statement && (
                                <div className="p-3 rounded-lg bg-rose-50/50 dark:bg-rose-900/10 border border-rose-100 dark:border-rose-900/20">
                                    <span className="text-xs font-bold text-rose-800 dark:text-rose-200">The Problem</span>
                                    <p className="text-sm text-zinc-700 dark:text-zinc-300 mt-1 line-clamp-3">
                                        {formData.problem_statement}
                                    </p>
                                </div>
                            )}
                            {formData.solution_overview && (
                                <div className="p-3 rounded-lg bg-emerald-50/50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/20">
                                    <span className="text-xs font-bold text-emerald-800 dark:text-emerald-200">The Solution</span>
                                    <p className="text-sm text-zinc-700 dark:text-zinc-300 mt-1 line-clamp-3">
                                        {formData.solution_overview}
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <Tag className="w-4 h-4 text-zinc-400" />
                            <span className="text-sm text-zinc-600 dark:text-zinc-400">
                                {formData.project_type || 'No type selected'}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <VisibilityIcon className="w-4 h-4 text-zinc-400" />
                            <span className="text-sm text-zinc-600 dark:text-zinc-400 capitalize">
                                {formData.visibility || 'public'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Tags & Tech */}
            {(formData.tags?.length > 0 || formData.technologies_used?.length > 0) && (
                <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h4 className="font-semibold text-zinc-900 dark:text-zinc-100">Tags & Technologies</h4>
                        <button
                            type="button"
                            onClick={() => goToPhase(2)}
                            className="flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700"
                        >
                            <Edit3 className="w-3 h-3" />
                            Edit
                        </button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {formData.tags?.map((tag) => (
                            <span key={tag} className="px-3 py-1 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-full text-sm">
                                {tag}
                            </span>
                        ))}
                        {formData.technologies_used?.map((tech) => (
                            <span key={tech} className="px-3 py-1 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-full text-sm">
                                {tech}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Team Section */}
            <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                    <h4 className="font-semibold text-zinc-900 dark:text-zinc-100">Team & Roles</h4>
                    <button
                        type="button"
                        onClick={() => goToPhase(3)}
                        className="flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700"
                    >
                        <Edit3 className="w-3 h-3" />
                        Edit
                    </button>
                </div>

                {formData.creator_role && (
                    <div className="mb-4 p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
                        <span className="text-sm text-indigo-600 dark:text-indigo-400">Your Role</span>
                        <p className="font-medium text-indigo-700 dark:text-indigo-300">
                            {formData.creator_role.title || formData.creator_role.role_type}
                        </p>
                    </div>
                )}

                {openRoles.length > 0 ? (
                    <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                            <Users className="w-4 h-4" />
                            <span>{openRoles.length} open position(s)</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {openRoles.map((role, i) => (
                                <span key={i} className="px-3 py-1 bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-full text-sm">
                                    {role.role || 'Unnamed role'} ({role.count})
                                </span>
                            ))}
                        </div>
                    </div>
                ) : (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">No open positions added</p>
                )}
            </div>

            {/* Ready to Launch */}
            <div className="text-center py-6 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-xl border border-indigo-100 dark:border-indigo-800">
                <h4 className="font-bold text-indigo-900 dark:text-indigo-100 mb-2">
                    Ready to launch your project?
                </h4>
                <p className="text-sm text-indigo-600 dark:text-indigo-400">
                    Click &quot;Launch Project&quot; below to publish your project and start finding collaborators.
                </p>
            </div>
        </div>
    );
}
