'use client';

import { useFormContext } from 'react-hook-form';
import { CreateProjectInput } from '@/lib/validations/project';
import { Globe, Lock } from 'lucide-react';
import { ProjectLinkEditorFields } from '@/components/projects/dashboard/ProjectSocialLinksCard';
import { socialLinkItemsFromStorage } from '@/lib/profile/normalization';

const DEFAULT_TERMS = {
    ip_agreement: 'discuss' as const,
    nda_required: 'none' as const,
    portfolio_showcase_allowed: true,
    license: '',
    additional_terms: '',
};

export default function Phase4Settings() {
    const { setValue, watch } = useFormContext<CreateProjectInput>();
    const visibility = watch('visibility');
    const terms = watch('terms');
    const externalLinks = socialLinkItemsFromStorage(watch('external_links'));
    const importSource = watch('import_source');

    const updateTerms = (updates: Partial<typeof DEFAULT_TERMS>) => {
        setValue('terms', {
            ...DEFAULT_TERMS,
            ...terms,
            ...updates,
        });
    };

    return (
        <div className="space-y-8">
            {/* Visibility */}
            <div>
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
                    Project Visibility
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
                    Control who can see and discover your project
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {[
                        { id: 'public', label: 'Public', icon: Globe, description: 'Anyone can find and view' },
                        { id: 'private', label: 'Private', icon: Lock, description: 'Only team members' },
                    ].map((opt) => {
                        const Icon = opt.icon;
                        const isSelected = visibility === opt.id;

                        return (
                            <button
                                key={opt.id}
                                type="button"
                                onClick={() => setValue('visibility', opt.id as 'public' | 'private')}
                                className={`flex flex-col items-start p-4 rounded-xl border-2 transition-all ${isSelected
                                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                                        : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
                                    }`}
                            >
                                <Icon className={`w-5 h-5 mb-2 ${isSelected ? 'text-indigo-600' : 'text-zinc-400'}`} />
                                <span className={`font-medium ${isSelected ? 'text-indigo-600' : 'text-zinc-700 dark:text-zinc-300'}`}>
                                    {opt.label}
                                </span>
                                <span className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                                    {opt.description}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Terms & IP */}
            <div>
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
                    Terms & IP
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
                    Set clear expectations for contributions
                </p>

                <div className="space-y-4">


                    <div className="flex items-center gap-3">
                        <input
                            type="checkbox"
                            checked={terms?.portfolio_showcase_allowed ?? true}
                            onChange={(e) => updateTerms({ portfolio_showcase_allowed: e.target.checked })}
                            className="w-4 h-4 rounded border-zinc-300 text-indigo-600 "
                        />
                        <label className="text-sm text-zinc-700 dark:text-zinc-300">
                            Contributors can showcase work in their portfolios
                        </label>
                    </div>
                </div>
            </div>

            {/* Project Links */}
            <div>
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
                    Project Links
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
                    Paste any public project destination. The service and icon are detected automatically.
                </p>
                <ProjectLinkEditorFields
                    links={externalLinks}
                    savedLinks={[]}
                    onChange={(links) => setValue('external_links', links, { shouldDirty: true, shouldValidate: true })}
                    githubRepoUrl={importSource?.type === 'github' ? importSource.repoUrl : null}
                    importSource={importSource}
                    projectType={watch('project_type')}
                />
            </div>
        </div>
    );
}
