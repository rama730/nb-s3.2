'use client';

import { useFormContext } from 'react-hook-form';
import { CreateProjectInput } from '@/lib/validations/project';
import { Globe, Lock, Link2 } from 'lucide-react';

const DEFAULT_TERMS = {
    ip_agreement: 'discuss' as const,
    nda_required: 'none' as const,
    portfolio_showcase_allowed: true,
    license: '',
    additional_terms: '',
};

export default function Phase4Settings() {
    const { register, setValue, watch } = useFormContext<CreateProjectInput>();
    const visibility = watch('visibility');
    const terms = watch('terms');

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

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {[
                        { id: 'public', label: 'Public', icon: Globe, description: 'Anyone can find and view' },
                        { id: 'unlisted', label: 'Unlisted', icon: Link2, description: 'Only people with the link' },
                        { id: 'private', label: 'Private', icon: Lock, description: 'Only team members' },
                    ].map((opt) => {
                        const Icon = opt.icon;
                        const isSelected = visibility === opt.id;

                        return (
                            <button
                                key={opt.id}
                                type="button"
                                onClick={() => setValue('visibility', opt.id as 'public' | 'private' | 'unlisted')}
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
                    <div>
                        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                            IP Agreement
                        </label>
                        <select
                            value={terms?.ip_agreement || 'discuss'}
                            onChange={(e) => updateTerms({ ip_agreement: e.target.value as typeof DEFAULT_TERMS.ip_agreement })}
                            className="w-full px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                        >
                            <option value="discuss">To be discussed</option>
                            <option value="company_owned">Company/Project owned</option>
                            <option value="contributor_owned">Contributor retains rights</option>
                            <option value="shared">Shared ownership</option>
                        </select>
                    </div>

                    <div className="flex items-center gap-3">
                        <input
                            type="checkbox"
                            checked={terms?.portfolio_showcase_allowed ?? true}
                            onChange={(e) => updateTerms({ portfolio_showcase_allowed: e.target.checked })}
                            className="w-4 h-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <label className="text-sm text-zinc-700 dark:text-zinc-300">
                            Contributors can showcase work in their portfolios
                        </label>
                    </div>
                </div>
            </div>

            {/* External Links */}
            <div>
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
                    External Links
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
                    Add links to your project resources
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                            GitHub
                        </label>
                        <input
                            {...register('external_links.github')}
                            type="url"
                            className="w-full px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                            placeholder="https://github.com/..."
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                            Website
                        </label>
                        <input
                            {...register('external_links.website')}
                            type="url"
                            className="w-full px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                            placeholder="https://..."
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                            Discord
                        </label>
                        <input
                            {...register('external_links.discord')}
                            type="url"
                            className="w-full px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                            placeholder="https://discord.gg/..."
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                            Figma
                        </label>
                        <input
                            {...register('external_links.figma')}
                            type="url"
                            className="w-full px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                            placeholder="https://figma.com/..."
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
