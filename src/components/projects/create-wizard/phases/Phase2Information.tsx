import { useFormContext } from 'react-hook-form';
import { CreateProjectInput } from '@/lib/validations/project';
import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import { LifecycleEditor } from '@/components/projects/LifecycleEditor';

const POPULAR_TAGS = ['AI/ML', 'Web3', 'SaaS', 'Mobile', 'API', 'Fintech', 'EdTech', 'HealthTech', 'E-commerce', 'DevTools'];
const POPULAR_TECH = ['React', 'Next.js', 'TypeScript', 'Node.js', 'Python', 'PostgreSQL', 'Tailwind', 'Supabase', 'Prisma', 'GraphQL'];

export default function Phase2Information() {
    const { register, setValue, watch, formState: { errors } } = useFormContext<CreateProjectInput>();
    const [tagInput, setTagInput] = useState('');
    const [techInput, setTechInput] = useState('');

    const tags = watch('tags') || [];
    const technologies = watch('technologies_used') || [];

    const addTag = (tag: string) => {
        if (tag && !tags.includes(tag)) {
            setValue('tags', [...tags, tag]);
        }
        setTagInput('');
    };

    const removeTag = (tag: string) => {
        setValue('tags', tags.filter(t => t !== tag));
    };

    const addTech = (tech: string) => {
        if (tech && !technologies.includes(tech)) {
            setValue('technologies_used', [...technologies, tech]);
        }
        setTechInput('');
    };

    const removeTech = (tech: string) => {
        setValue('technologies_used', technologies.filter(t => t !== tech));
    };

    return (
        <div className="space-y-6">
            {/* Title */}
            <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                    Project Title *
                </label>
                <input
                    {...register('title')}
                    className="w-full px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="My Awesome Project"
                />
                {errors.title && <p className="mt-1 text-sm text-red-500">{errors.title.message}</p>}
            </div>

            {/* Short Description */}
            <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                    Tagline
                </label>
                <input
                    {...register('short_description')}
                    className="w-full px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="A brief tagline for your project"
                    maxLength={200}
                />
            </div>

            {/* Full Description */}
            <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                    Description *
                </label>
                <textarea
                    {...register('description')}
                    rows={5}
                    className="w-full px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                    placeholder="Describe your project in detail. What problem does it solve? What are your goals?"
                />
                {errors.description && <p className="mt-1 text-sm text-red-500">{errors.description.message}</p>}
            </div>

            {/* Problem & Solution (Added to match Edit Modal) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                        Problem Statement
                    </label>
                    <textarea
                        {...register('problem_statement')}
                        rows={3}
                        className="w-full px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                        placeholder="What problem are you solving?"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                        Solution Overview
                    </label>
                    <textarea
                        {...register('solution_statement')}
                        rows={3}
                        className="w-full px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                        placeholder="How does your project solve it?"
                    />
                </div>
            </div>

            {/* Tags */}
            <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                    Tags
                </label>
                <div className="flex flex-wrap gap-2 mb-3">
                    {tags.map((tag) => (
                        <span key={tag} className="inline-flex items-center gap-1 px-3 py-1 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-full text-sm">
                            {tag}
                            <button type="button" onClick={() => removeTag(tag)} className="hover:text-indigo-800">
                                <X className="w-3 h-3" />
                            </button>
                        </span>
                    ))}
                </div>
                <div className="flex gap-2">
                    <input
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                addTag(tagInput);
                            }
                        }}
                        className="flex-1 px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                        placeholder="Add a tag"
                    />
                    <button
                        type="button"
                        onClick={() => addTag(tagInput)}
                        className="px-3 py-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                    {POPULAR_TAGS.filter(t => !tags.includes(t)).slice(0, 5).map((tag) => (
                        <button
                            key={tag}
                            type="button"
                            onClick={() => addTag(tag)}
                            className="px-2 py-1 text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700"
                        >
                            + {tag}
                        </button>
                    ))}
                </div>
            </div>

            {/* Technologies */}
            <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                    Tech Stack
                </label>
                <div className="flex flex-wrap gap-2 mb-3">
                    {technologies.map((tech) => (
                        <span key={tech} className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-full text-sm">
                            {tech}
                            <button type="button" onClick={() => removeTech(tech)} className="hover:text-emerald-800">
                                <X className="w-3 h-3" />
                            </button>
                        </span>
                    ))}
                </div>
                <div className="flex gap-2">
                    <input
                        value={techInput}
                        onChange={(e) => setTechInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                addTech(techInput);
                            }
                        }}
                        className="flex-1 px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                        placeholder="Add a technology"
                    />
                    <button
                        type="button"
                        onClick={() => addTech(techInput)}
                        className="px-3 py-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                    {POPULAR_TECH.filter(t => !technologies.includes(t)).slice(0, 5).map((tech) => (
                        <button
                            key={tech}
                            type="button"
                            onClick={() => addTech(tech)}
                            className="px-2 py-1 text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700"
                        >
                            + {tech}
                        </button>
                    ))}
                </div>
            </div>

            {/* Lifecycle Stages - Moved from Phase 4 */}
            <div>
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
                    Project Lifecycle
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
                    Define the stages your project will go through
                </p>
                <div className="bg-zinc-50 dark:bg-zinc-900/50 p-4 rounded-xl border border-zinc-100 dark:border-zinc-800">
                    <LifecycleEditor 
                        stages={watch('lifecycle_stages') || []}
                        onChange={(stages) => setValue('lifecycle_stages', stages)}
                    />
                </div>
            </div>
        </div>
    );
}
