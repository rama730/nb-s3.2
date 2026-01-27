'use client';

import { useFormContext } from 'react-hook-form';
import { CreateProjectInput } from '@/lib/validations/project';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Plus, Check, Edit2 } from 'lucide-react';

const POPULAR_TAGS = ['AI/ML', 'Web3', 'SaaS', 'Mobile', 'API', 'Fintech', 'EdTech', 'HealthTech', 'E-commerce', 'DevTools'];
const POPULAR_TECH = ['React', 'Next.js', 'TypeScript', 'Node.js', 'Python', 'PostgreSQL', 'Tailwind', 'Supabase', 'Prisma', 'GraphQL'];
const DEFAULT_STAGES = ['Idea', 'MVP', 'Testing', 'Launch', 'Growth'];
const STAGE_COLORS = ['bg-yellow-500', 'bg-blue-500', 'bg-purple-500', 'bg-green-500', 'bg-indigo-500', 'bg-pink-500', 'bg-orange-500'];

export default function Phase2Information() {
    const { register, setValue, watch, formState: { errors } } = useFormContext<CreateProjectInput>();
    const [tagInput, setTagInput] = useState('');
    const [techInput, setTechInput] = useState('');

    const tags = watch('tags') || [];
    const technologies = watch('technologies_used') || [];
    const lifecycleStages = watch('lifecycle_stages') || [];

    // Initialize stages if empty
    const [stages, setStages] = useState<string[]>(
        lifecycleStages.length > 0 ? lifecycleStages : DEFAULT_STAGES
    );
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editValue, setEditValue] = useState('');
    const [newStage, setNewStage] = useState('');

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

    // Stage management
    const startEdit = (index: number) => {
        setEditingIndex(index);
        setEditValue(stages[index]);
    };

    const saveEdit = () => {
        if (editingIndex !== null && editValue.trim()) {
            const newStages = [...stages];
            newStages[editingIndex] = editValue.trim();
            setStages(newStages);
            setValue('lifecycle_stages', newStages);
        }
        setEditingIndex(null);
        setEditValue('');
    };

    const removeStage = (index: number) => {
        const newStages = stages.filter((_, i) => i !== index);
        setStages(newStages);
        setValue('lifecycle_stages', newStages);
    };

    const addStage = () => {
        if (newStage.trim() && stages.length < 7) {
            const updated = [...stages, newStage.trim()];
            setStages(updated);
            setValue('lifecycle_stages', updated);
            setNewStage('');
        }
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

            {/* Project Lifecycle Stages */}
            <div className="pt-4 border-t border-zinc-200 dark:border-zinc-700">
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                    Project Lifecycle
                </label>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
                    Define the stages your project will go through. Click any stage to edit, or add new ones.
                </p>

                <div className="flex flex-wrap gap-2">
                    {stages.map((stage, index) => (
                        <motion.div
                            key={index}
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: index * 0.03 }}
                            className="group relative"
                        >
                            {editingIndex === index ? (
                                <div className="flex items-center gap-1">
                                    <input
                                        type="text"
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') saveEdit();
                                            if (e.key === 'Escape') setEditingIndex(null);
                                        }}
                                        autoFocus
                                        className="w-28 px-3 py-1.5 text-sm rounded-lg border border-indigo-300 bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                    <button
                                        type="button"
                                        onClick={saveEdit}
                                        className="p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg"
                                    >
                                        <Check className="w-4 h-4" />
                                    </button>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:border-indigo-300 dark:hover:border-indigo-600 transition-colors">
                                    <div className={`w-2.5 h-2.5 rounded-full ${STAGE_COLORS[index % STAGE_COLORS.length]}`} />
                                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                        {stage}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => startEdit(index)}
                                        className="p-0.5 text-zinc-400 hover:text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <Edit2 className="w-3 h-3" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => removeStage(index)}
                                        className="p-0.5 text-zinc-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                </div>
                            )}
                        </motion.div>
                    ))}

                    {/* Add Stage */}
                    {stages.length < 7 && (
                        <div className="flex items-center gap-1">
                            <input
                                type="text"
                                value={newStage}
                                onChange={(e) => setNewStage(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        addStage();
                                    }
                                }}
                                placeholder="+ Add stage"
                                className="w-28 px-3 py-1.5 text-sm rounded-lg border border-dashed border-zinc-300 dark:border-zinc-600 bg-transparent text-zinc-600 dark:text-zinc-400 placeholder-zinc-400 focus:outline-none focus:border-indigo-400"
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
