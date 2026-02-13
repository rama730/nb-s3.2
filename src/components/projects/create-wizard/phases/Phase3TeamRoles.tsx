'use client';

import { useEffect } from 'react';
import { useFormContext } from 'react-hook-form';
import { CreateProjectInput } from '@/lib/validations/project';
import { WizardContextType } from '../useCreateProjectWizard';
import { Plus, Trash2, UserCircle } from 'lucide-react';

const ROLE_OPTIONS = [
    'Frontend Developer',
    'Backend Developer',
    'Full Stack Developer',
    'UI/UX Designer',
    'Product Manager',
    'DevOps Engineer',
    'Data Scientist',
    'Mobile Developer',
    'QA Engineer',
    'Technical Writer',
    'Marketing',
    'Community Manager',
];

interface Phase3TeamRolesProps {
    wizardContext: WizardContextType;
}

export default function Phase3TeamRoles({ wizardContext }: Phase3TeamRolesProps) {
    const { getValues, setValue, watch } = useFormContext<CreateProjectInput>();
    const { openRoles, addRole, updateRole, removeRole } = wizardContext;

    const creatorRole = watch('creator_role');
    const leadFocus = creatorRole?.title || '';

    useEffect(() => {
        const currentRole = getValues('creator_role');
        if (!currentRole || currentRole.role_type !== 'lead') {
            setValue(
                'creator_role',
                {
                    role_type: 'lead',
                    title: currentRole?.title || '',
                    time_commitment: currentRole?.time_commitment,
                },
                { shouldDirty: !!currentRole && currentRole.role_type !== 'lead' }
            );
        }
    }, [getValues, setValue]);

    return (
        <div className="space-y-8">
            {/* Creator's Role */}
            <div>
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
                    Your Role
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
                    Project creator is always the lead. Add an optional focus area.
                </p>

                <div className="mb-4 rounded-xl border border-indigo-200 dark:border-indigo-900/40 bg-indigo-50/60 dark:bg-indigo-900/15 px-4 py-3">
                    <p className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">Lead</p>
                    <p className="text-xs text-indigo-600/80 dark:text-indigo-300/70">
                        You own direction, decisions, and team alignment.
                    </p>
                </div>

                <input
                    value={leadFocus}
                    onChange={(e) =>
                        setValue('creator_role', {
                            role_type: 'lead',
                            title: e.target.value,
                            time_commitment: creatorRole?.time_commitment,
                        })
                    }
                    className="w-full px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                    placeholder="Lead focus (optional, e.g. Frontend, Product, AI)"
                    maxLength={80}
                />
            </div>

            {/* Open Roles */}
            <div>
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                            Open Positions
                        </h3>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                            Add roles you&apos;re looking to fill
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={addRole}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium text-sm transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        Add Role
                    </button>
                </div>

                {openRoles.length === 0 ? (
                    <div className="text-center py-12 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border-2 border-dashed border-zinc-200 dark:border-zinc-700">
                        <UserCircle className="w-12 h-12 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
                        <p className="text-zinc-500 dark:text-zinc-400">No open positions yet</p>
                        <p className="text-sm text-zinc-400 dark:text-zinc-500 mt-1">
                            Click &quot;Add Role&quot; to define positions you need to fill
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {openRoles.map((role, index) => (
                            <div key={index} className="p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-700">
                                <div className="flex items-start justify-between mb-3">
                                    <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                                        Role #{index + 1}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => removeRole(index)}
                                        className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                            Role Title
                                        </label>
                                        <select
                                            value={role.role}
                                            onChange={(e) => updateRole(index, { role: e.target.value })}
                                            className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                                        >
                                            <option value="">Select a role</option>
                                            {ROLE_OPTIONS.map((r) => (
                                                <option key={r} value={r}>{r}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                            Positions Available
                                        </label>
                                        <input
                                            type="number"
                                            min={1}
                                            max={10}
                                            value={role.count}
                                            onChange={(e) => updateRole(index, { count: parseInt(e.target.value) || 1 })}
                                            className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                                        />
                                    </div>

                                    <div className="md:col-span-2">
                                        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                            Description
                                        </label>
                                        <textarea
                                            value={role.description || ''}
                                            onChange={(e) => updateRole(index, { description: e.target.value })}
                                            rows={2}
                                            className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 resize-none"
                                            placeholder="What will this person be responsible for?"
                                        />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
