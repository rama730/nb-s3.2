"use client";

import React, { useState, useEffect, useRef, useTransition } from "react";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { motion, AnimatePresence } from "framer-motion";
import { LifecycleEditor } from "@/components/projects/LifecycleEditor";
import { 
    Layout, FileText, Layers, Users, X, Sparkles, Plus, Trash2, 
    Check, Globe, Lock, Info, ChevronRight, Hash, CheckCircle 
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { updateProject } from "@/app/actions/project";

// --- Types & Schema ---

const roleSchema = z.object({
    id: z.string().optional(),
    role: z.string().min(1, "Role name is required"),
    count: z.number().min(1, "Count must be at least 1"),
    description: z.string().optional(),
    skills: z.array(z.string()).optional(),
});

const projectSchema = z.object({
    status: z.enum(["draft", "active", "completed", "archived"]),
    visibility: z.enum(["public", "private", "unlisted"]),
    title: z.string().min(1, "Title is required").max(100),
    short_description: z.string().max(200, "Tagline must be less than 200 characters").optional(),
    description: z.string().optional(),
    problem_statement: z.string().optional(),
    solution_statement: z.string().optional(),
    technologies_used: z.array(z.string()),
    tags: z.array(z.string()),
    roles: z.array(roleSchema),
    lifecycle_stages: z.array(z.string()),
    current_stage_index: z.number(),
});

type ProjectFormValues = z.infer<typeof projectSchema>;

interface EditProjectModalProps {
    project: any; // Using any for flexibility with joined data
    isOpen: boolean;
    onClose: () => void;
    onSaved?: () => void;
}

// --- Icons & Config ---

const TABS = [
    { id: "essentials", label: "Essentials", icon: Layout },
    { id: "details", label: "Details", icon: FileText },
    { id: "stack", label: "Stack & Links", icon: Layers },
    { id: "journey", label: "Journey", icon: CheckCircle },
    { id: "roles", label: "Team & Roles", icon: Users },
] as const;

// --- Components ---

function StatusSelector({ value, onChange }: { value: string; onChange: (val: string) => void }) {
    const options = [
        { id: "draft", label: "Planning", desc: "Just getting started", color: "bg-blue-50 border-blue-200 text-blue-700" },
        { id: "active", label: "In Progress", desc: "Actively building", color: "bg-emerald-50 border-emerald-200 text-emerald-700" },
        { id: "completed", label: "Completed", desc: "Finished & Live", color: "bg-purple-50 border-purple-200 text-purple-700" },
    ];

    return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {options.map((opt) => {
                const isSelected = value === opt.id;
                return (
                    <button
                        key={opt.id}
                        type="button"
                        onClick={() => onChange(opt.id)}
                        className={cn(
                            "relative flex flex-col items-start p-3 rounded-xl border-2 transition-all text-left",
                            isSelected
                                ? "border-indigo-600 bg-indigo-50/10 dark:bg-indigo-900/10"
                                : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700"
                        )}
                    >
                        {isSelected && (
                            <div className="absolute top-2 right-2 text-indigo-600">
                                <Check className="w-4 h-4" />
                            </div>
                        )}
                        <span className={cn(
                            "inline-block w-2.5 h-2.5 rounded-full mb-2",
                            opt.id === "draft" && "bg-blue-500",
                            opt.id === "active" && "bg-emerald-500",
                            opt.id === "completed" && "bg-purple-500"
                        )} />
                        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{opt.label}</span>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{opt.desc}</span>
                    </button>
                );
            })}
        </div>
    );
}

function VisibilitySelector({ value, onChange }: { value: string; onChange: (val: string) => void }) {
    const options = [
        { id: "public", label: "Public", desc: "Visible to everyone", icon: Globe },
        { id: "unlisted", label: "Unlisted", desc: "Link access only", icon: Hash },
        { id: "private", label: "Private", desc: "Only members", icon: Lock },
    ];

    return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {options.map((opt) => {
                const isSelected = value === opt.id;
                return (
                    <button
                        key={opt.id}
                        type="button"
                        onClick={() => onChange(opt.id)}
                        className={cn(
                            "flex flex-col gap-2 p-3 rounded-xl border-2 transition-all text-left",
                            isSelected
                                ? "border-indigo-600 bg-indigo-50/10 dark:bg-indigo-900/10"
                                : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700"
                        )}
                    >
                        <div className={cn(
                            "p-1.5 rounded-lg w-fit",
                            isSelected ? "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
                        )}>
                            <opt.icon className="w-4 h-4" />
                        </div>
                        <div>
                            <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">{opt.label}</span>
                            <span className="text-xs text-zinc-500 dark:text-zinc-400">{opt.desc}</span>
                        </div>
                    </button>
                );
            })}
        </div>
    );
}

// --- Main Component ---

export default function EditProjectModal({ project, isOpen, onClose, onSaved }: EditProjectModalProps) {
    const [activeTab, setActiveTab] = useState("essentials");
    const [isPending, startTransition] = useTransition();
    const router = useRouter();

    // Setup Form
    const { register, control, handleSubmit, watch, setValue, formState: { errors } } = useForm<ProjectFormValues>({
        resolver: zodResolver(projectSchema),
        defaultValues: {
            status: project.status || "draft",
            visibility: project.visibility || "public",
            title: project.title || "",
            short_description: project.short_description || "",
            description: project.description || "",
            problem_statement: project.problem_statement || "",
            solution_statement: project.solution_statement || "",
            technologies_used: project.technologies_used || [], // Assuming column name matches logic or needs transformation
            tags: project.tags || [],
            // Check camelCase (Drizzle default) then snake_case (Raw/Legacy)
            // Use defaults ONLY if both are null/undefined, effectively initializing new/legacy projects
            lifecycle_stages: (project.lifecycleStages ?? project.lifecycle_stages) ?? ["Concept", "Team Formation", "MVP", "Beta", "Launch"],
            current_stage_index: project.current_stage_index ?? 0,
            roles: project.project_open_roles?.map((r: any) => ({
                id: r.id,
                role: r.role,
                count: r.count,
                description: r.description,
                skills: r.skills
            })) || [],
        }
    });

    const { fields: roleFields, append: appendRole, remove: removeRole } = useFieldArray({
        control,
        name: "roles"
    });

    const [deletedRoleIds, setDeletedRoleIds] = useState<string[]>([]);

    // Tech Stack Input State
    const [techInput, setTechInput] = useState("");
    const technologies = watch("technologies_used");
    
    // Tag Input State
    const [tagInput, setTagInput] = useState("");
    const tags = watch("tags");

    // Auto-grow Textarea
    const adjustHeight = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        e.target.style.height = "auto";
        e.target.style.height = `${e.target.scrollHeight}px`;
    };

    const handleKeyDown = (
        e: React.KeyboardEvent, 
        value: string, 
        setValueState: (v: string) => void,
        currentList: string[],
        fieldName: "technologies_used" | "tags"
    ) => {
        if (e.key === "Enter") {
            e.preventDefault();
            if (value.trim()) {
                if (!currentList.includes(value.trim())) {
                    setValue(fieldName, [...currentList, value.trim()]);
                }
                setValueState("");
            }
        }
    };

    const onSubmit = (data: ProjectFormValues) => {
        startTransition(async () => {
            try {
                // Pass data + deletedRoleIds to action
                const { technologies_used, ...rest } = data;
                
                const dbPayload = {
                    ...rest,
                    skills: technologies_used, // Map to DB 'skills' column
                    deletedRoleIds,
                    // Auto-include lifecycle fields from rest since they are in schema
                };

                await updateProject(project.id, dbPayload);
                toast.success("Project updated successfully");
                if (onSaved) onSaved();
                onClose();
            } catch (error) {
                console.error(error);
                toast.error("Failed to update project");
            }
        });
    };

    const handleDeleteRole = (index: number, roleId?: string) => {
        if (roleId) {
            setDeletedRoleIds(prev => [...prev, roleId]);
        }
        removeRole(index);
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md"
                >
                    {/* Backdrop Click */}
                    <div className="absolute inset-0" onClick={onClose} />

                    <motion.div
                        initial={{ scale: 0.95, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.95, opacity: 0 }}
                        className="relative z-10 w-full max-w-5xl h-[85vh] rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl flex flex-col overflow-hidden"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center ring-2 ring-indigo-500/20">
                                    <Sparkles className="w-5 h-5 text-white" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Edit Project</h2>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">Make your project stand out</p>
                                </div>
                            </div>
                            <button 
                                onClick={onClose}
                                className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="flex flex-1 min-h-0">
                            {/* Sidebar (md+) */}
                            <div className="w-64 border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 hidden md:flex flex-col p-4 gap-1 overflow-y-auto shrink-0">
                                {TABS.map((tab) => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveTab(tab.id)}
                                        className={cn(
                                            "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all",
                                            activeTab === tab.id
                                                ? "bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-sm ring-1 ring-zinc-200 dark:ring-zinc-700"
                                                : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
                                        )}
                                    >
                                        <tab.icon className="w-4 h-4" />
                                        {tab.label}
                                    </button>
                                ))}
                            </div>

                            {/* Mobile Tab Strip (visible on small screens) */}
                            {/* Skipping complex mobile tabs for brevity, can just stack or rely on standard responsiveness if needed, but flex-col implies simple vertical list. */}

                            {/* Content Form */}
                            <form 
                                id="edit-project-form" 
                                onSubmit={handleSubmit(onSubmit)}
                                className="flex-1 overflow-y-auto p-6 md:p-8 pb-24"
                            >
                                <div className="max-w-3xl mx-auto space-y-8">
                                    {/* ESSENTIALS */}
                                    {activeTab === "essentials" && (
                                        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                            <div className="space-y-6 bg-zinc-50/50 dark:bg-zinc-800/30 p-6 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                                                <Controller
                                                    control={control}
                                                    name="status"
                                                    render={({ field }) => (
                                                        <div>
                                                            <label className="block text-sm font-medium mb-3 text-zinc-900 dark:text-zinc-100">Project Status</label>
                                                            <StatusSelector value={field.value} onChange={field.onChange} />
                                                        </div>
                                                    )}
                                                />
                                                <div className="w-full h-px bg-zinc-200 dark:bg-zinc-800" />
                                                <Controller
                                                    control={control}
                                                    name="visibility"
                                                    render={({ field }) => (
                                                        <div>
                                                            <label className="block text-sm font-medium mb-3 text-zinc-900 dark:text-zinc-100">Visibility</label>
                                                            <VisibilitySelector value={field.value} onChange={field.onChange} />
                                                        </div>
                                                    )}
                                                />
                                            </div>

                                            <div className="space-y-4">
                                                <div>
                                                    <label className="block text-sm font-medium mb-1.5 ">Project Title</label>
                                                    <input
                                                        {...register("title")}
                                                        className="w-full px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                                                        placeholder="e.g. NextGen CRM"
                                                    />
                                                    {errors.title && <p className="text-red-500 text-sm mt-1">{errors.title.message}</p>}
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium mb-1.5">Tagline</label>
                                                    <input
                                                        {...register("short_description")}
                                                        className="w-full px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                                                        placeholder="A brief pitch for your project..."
                                                    />
                                                    {errors.short_description && <p className="text-red-500 text-sm mt-1">{errors.short_description.message}</p>}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* DETAILS */}
                                    {activeTab === "details" && (
                                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                            <div>
                                                <label className="block text-sm font-medium mb-2">Full Description</label>
                                                <textarea
                                                    {...register("description")}
                                                    onInput={(e: any) => adjustHeight(e)}
                                                    className="w-full px-4 py-3 min-h-[150px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all resize-none"
                                                    placeholder="Tell the full story of your project..."
                                                />
                                            </div>
                                            <div className="grid gap-6">
                                                <div>
                                                    <label className="block text-sm font-medium mb-2">Problem Statement</label>
                                                    <textarea
                                                        {...register("problem_statement")}
                                                        onInput={(e: any) => adjustHeight(e)}
                                                        className="w-full px-4 py-3 min-h-[100px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all resize-none"
                                                        placeholder="What problem are you solving?"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium mb-2">Solution Overview</label>
                                                    <textarea
                                                        {...register("solution_statement")}
                                                        onInput={(e: any) => adjustHeight(e)}
                                                        className="w-full px-4 py-3 min-h-[100px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all resize-none"
                                                        placeholder="How does your project solve it?"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* STACK & LINKS */}
                                    {activeTab === "stack" && (
                                        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                            {/* Tech Stack */}
                                            <div>
                                                <label className="block text-sm font-medium mb-2">Technology Stack</label>
                                                <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 min-h-[100px] bg-zinc-50/30 dark:bg-zinc-800/20">
                                                    <div className="flex flex-wrap gap-2 mb-3">
                                                        {technologies.map((tech) => (
                                                            <span key={tech} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-100 dark:bg-zinc-700 text-sm border border-zinc-200 dark:border-zinc-600">
                                                                {tech}
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setValue("technologies_used", technologies.filter(t => t !== tech))}
                                                                    className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                                                                >
                                                                    <X className="w-3.5 h-3.5" />
                                                                </button>
                                                            </span>
                                                        ))}
                                                    </div>
                                                    <input
                                                        value={techInput}
                                                        onChange={(e) => setTechInput(e.target.value)}
                                                        onKeyDown={(e) => handleKeyDown(e, techInput, setTechInput, technologies, "technologies_used")}
                                                        placeholder="Type technology (e.g. React) and press Enter..."
                                                        className="w-full bg-transparent outline-none text-sm placeholder:text-zinc-400"
                                                    />
                                                </div>
                                            </div>

                                            {/* Tags */}
                                            <div>
                                                <label className="block text-sm font-medium mb-2">Tags</label>
                                                <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 min-h-[80px] bg-zinc-50/30 dark:bg-zinc-800/20">
                                                    <div className="flex flex-wrap gap-2 mb-3">
                                                        {tags.map((tag) => (
                                                            <span key={tag} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-sm border border-blue-100 dark:border-blue-800">
                                                                #{tag}
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setValue("tags", tags.filter(t => t !== tag))}
                                                                    className="text-blue-400 hover:text-blue-600 dark:hover:text-blue-200"
                                                                >
                                                                    <X className="w-3.5 h-3.5" />
                                                                </button>
                                                            </span>
                                                        ))}
                                                    </div>
                                                    <input
                                                        value={tagInput}
                                                        onChange={(e) => setTagInput(e.target.value)}
                                                        onKeyDown={(e) => handleKeyDown(e, tagInput, setTagInput, tags, "tags")}
                                                        placeholder="Type tag (e.g. opensource) and press Enter..."
                                                        className="w-full bg-transparent outline-none text-sm placeholder:text-zinc-400"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* JOURNEY */}
                                    {activeTab === "journey" && (
                                        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                            <div>
                                                <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-2">Project Journey</h3>
                                                <p className="text-sm text-zinc-500 mb-6">Customize the stages your project will progress through.</p>
                                                
                                                <div className="bg-zinc-50 dark:bg-zinc-900/50 p-6 rounded-xl border border-zinc-200 dark:border-zinc-800">
                                                    <LifecycleEditor 
                                                        stages={watch('lifecycle_stages')}
                                                        onChange={(stages) => setValue('lifecycle_stages', stages)}
                                                        currentStageIndex={watch('current_stage_index')}
                                                    />
                                                </div>

                                                <div className="mt-6 p-4 rounded-lg bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/20 flex gap-3 text-sm text-blue-700 dark:text-blue-300">
                                                    <Info className="w-5 h-5 shrink-0" />
                                                    <p>
                                                        Use the dashboard "Advance" button to move between these stages. 
                                                        Reordering stages here will update the roadmap immediately.
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* ROLES */}
                                    {activeTab === "roles" && (
                                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Project Roles</h3>
                                                    <p className="text-sm text-zinc-500">Define open positions for collaborators</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => appendRole({ role: "New Role", count: 1, description: "", skills: [] })}
                                                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors shadow-sm"
                                                >
                                                    <Plus className="w-4 h-4" />
                                                    Add Role
                                                </button>
                                            </div>

                                            <div className="grid gap-4">
                                                {roleFields.length === 0 ? (
                                                    <div className="p-8 text-center border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl text-zinc-400 text-sm">
                                                        No open roles listed. Add one to invite collaborators.
                                                    </div>
                                                ) : (
                                                    roleFields.map((field, index) => (
                                                        <div key={field.id} className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm animate-in zoom-in-95 duration-200">
                                                            <div className="flex gap-4 items-start">
                                                                <div className="flex-1 space-y-1.5">
                                                                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Role Title</label>
                                                                    <input
                                                                        {...register(`roles.${index}.role`)}
                                                                        placeholder="e.g. Frontend Developer"
                                                                        className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
                                                                    />
                                                                    {errors.roles?.[index]?.role && (
                                                                        <p className="text-red-500 text-xs">{errors.roles[index]?.role?.message}</p>
                                                                    )}
                                                                </div>
                                                            <div className="w-24 space-y-1.5">
                                                                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Count</label>
                                                                    <input
                                                                        type="number"
                                                                        {...register(`roles.${index}.count`, { valueAsNumber: true })}
                                                                        className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
                                                                    />
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleDeleteRole(index, field.id)}
                                                                    className="mt-6 p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition-colors"
                                                                >
                                                                    <Trash2 className="w-5 h-5" />
                                                                </button>
                                                            </div>
                                                            <div className="mt-4">
                                                                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Description (Optional)</label>
                                                                <textarea
                                                                    {...register(`roles.${index}.description`)}
                                                                    placeholder="Describe the responsibilities and requirements..."
                                                                    className="w-full mt-1.5 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none min-h-[80px]"
                                                                />
                                                            </div>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </form>
                        </div>

                        {/* Sticky Footer */}
                        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md flex items-center gap-3 shrink-0 z-20">
                            <div className="mr-auto hidden sm:block">
                                <p className="text-xs text-zinc-400">
                                    {isPending ? "Saving changes..." : "Unsaved changes will be lost if you cancel."}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-5 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 font-medium text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                form="edit-project-form"
                                disabled={isPending}
                                className="px-6 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                {isPending && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                                {isPending ? "Saving..." : "Save Changes"}
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
