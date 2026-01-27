'use client';

import { useFormContext } from 'react-hook-form';
import { CreateProjectInput } from '@/lib/validations/project';
import {
    Lightbulb, Rocket, Code2, Users, GraduationCap, Briefcase,
    Palette, HeartHandshake, Gamepad2, Globe, ShoppingBag,
    Wrench, BookOpen, Mic, Film
} from 'lucide-react';

const PROJECT_TYPES = [
    { id: 'side_project', label: 'Side Project', icon: Lightbulb, description: 'Personal project or hobby' },
    { id: 'startup', label: 'Startup', icon: Rocket, description: 'Building a business' },
    { id: 'open_source', label: 'Open Source', icon: Code2, description: 'Community contribution' },
    { id: 'learning', label: 'Learning Project', icon: GraduationCap, description: 'Skill development' },
    { id: 'hackathon', label: 'Hackathon', icon: Users, description: 'Competition project' },
    { id: 'freelance', label: 'Freelance/Client', icon: Briefcase, description: 'Client work' },
    { id: 'creative', label: 'Creative/Art', icon: Palette, description: 'Art or design project' },
    { id: 'nonprofit', label: 'Non-Profit', icon: HeartHandshake, description: 'Social impact' },
    { id: 'game', label: 'Game Dev', icon: Gamepad2, description: 'Video game project' },
    { id: 'web_app', label: 'Web App', icon: Globe, description: 'Web application' },
    { id: 'ecommerce', label: 'E-Commerce', icon: ShoppingBag, description: 'Online store' },
    { id: 'tool', label: 'Developer Tool', icon: Wrench, description: 'Dev tools & utilities' },
    { id: 'content', label: 'Content/Blog', icon: BookOpen, description: 'Content platform' },
    { id: 'podcast', label: 'Podcast/Audio', icon: Mic, description: 'Audio content' },
    { id: 'video', label: 'Video/Media', icon: Film, description: 'Video content' },
];

export default function Phase1TypeSelection() {
    const { setValue, watch, formState: { errors } } = useFormContext<CreateProjectInput>();
    const selectedType = watch('project_type');

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
                    What type of project are you building?
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Choose the category that best describes your project. This helps collaborators find you.
                </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                {PROJECT_TYPES.map((type) => {
                    const Icon = type.icon;
                    const isSelected = selectedType === type.id;

                    return (
                        <button
                            key={type.id}
                            type="button"
                            onClick={() => setValue('project_type', type.id, { shouldValidate: true })}
                            className={`flex flex-col items-center p-4 rounded-xl border-2 transition-all ${isSelected
                                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                                    : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
                                }`}
                        >
                            <Icon className={`w-6 h-6 mb-2 ${isSelected ? 'text-indigo-600' : 'text-zinc-400'}`} />
                            <span className={`text-sm font-medium text-center ${isSelected ? 'text-indigo-600' : 'text-zinc-700 dark:text-zinc-300'}`}>
                                {type.label}
                            </span>
                            <span className="text-xs text-zinc-400 dark:text-zinc-500 text-center mt-1">
                                {type.description}
                            </span>
                        </button>
                    );
                })}
            </div>

            {errors.project_type && (
                <p className="text-sm text-red-500 mt-2">{errors.project_type.message}</p>
            )}
        </div>
    );
}
