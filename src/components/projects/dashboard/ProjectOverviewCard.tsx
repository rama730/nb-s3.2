"use client";

import { Edit, Share2, Bookmark, CheckCircle, ArrowRight, Lock, Github, ExternalLink, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import Link from "next/link";

interface ProjectOverviewCardProps {
    project: any;
    isCreator: boolean;
    bookmarked: boolean;
    bookmarkCount: number;
    followersCount: number;
    membersCount: number;
    hideActionBar?: boolean;
    onEdit: () => void;
    onShare: () => void;
    onBookmark: () => void;
    onFinalize: () => void;
    shareCopied: boolean;
    bookmarkLoading: boolean;
    lifecycleStages: { name: string; status: string }[];
    currentStageIndex: number;
    onAdvanceStage: () => void;
}

export default function ProjectOverviewCard({
    project,
    isCreator,
    bookmarked,
    bookmarkCount,
    followersCount,
    membersCount,
    hideActionBar,
    onEdit,
    onShare,
    onBookmark,
    onFinalize,
    shareCopied,
    bookmarkLoading,
    lifecycleStages,
    currentStageIndex,
    onAdvanceStage,
}: ProjectOverviewCardProps) {

    // Mock stages if empty
    // Forced recompile
    const stages = lifecycleStages ?? [];

    const statusColors: Record<string, string> = {
        planning: "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
        in_progress: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-300 dark:border-indigo-800",
        completed: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800",
    };

    const statusLabels: Record<string, string> = {
        planning: "Planning",
        in_progress: "In Progress",
        completed: "Completed",
    };

    return (
        <motion.div
            className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden flex flex-col h-fit"
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
        >
            <div className="p-8">
                {/* Header: Type & Status */}
                <div className="flex items-center gap-3 mb-6">
                    <span className={cn(
                        "rounded-full px-3 py-1 text-xs font-semibold border",
                        statusColors[project?.status?.toLowerCase()] || statusColors.planning
                    )}>
                        {statusLabels[project?.status?.toLowerCase()] || "Planning"}
                    </span>
                    {(project?.category || project?.project_type || project?.custom_project_type) && (
                        <span className="px-3 py-1 text-xs font-medium rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
                            {project.category || project.custom_project_type || project.project_type}
                        </span>
                    )}
                    {project?.visibility === "private" && (
                        <span className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
                            <Lock className="w-3 h-3" />
                            Private
                        </span>
                    )}
                </div>

                {/* Hero Section: Title & Tagline */}
                <div className="mb-8">
                    <h1 className="text-4xl font-extrabold text-zinc-900 dark:text-zinc-50 mb-4 tracking-tight leading-tight">
                        {project?.title}
                    </h1>
                    {project?.shortDescription && (
                        <p className="text-xl text-zinc-500 dark:text-zinc-400 font-medium leading-relaxed max-w-3xl">
                            {project.shortDescription}
                        </p>
                    )}
                </div>

                {/* Action Bar */}
                {!hideActionBar && (
                    <div className="flex items-center justify-between py-6 border-t border-b border-zinc-100 dark:border-zinc-800 mb-8">
                        {/* (Action bar content omitted as per spec logic when hidden, but included here structure-wise if flag false) */}
                        <div className="flex items-center gap-2">
                            <button onClick={onShare} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                                <Share2 className="w-4 h-4" />
                                Share
                            </button>
                        </div>
                    </div>
                )}

                {/* Content Tabs / Sections */}
                <div className="grid grid-cols-1 gap-8">
                    {/* Project Journey (Timeline) */}
                    <section className="bg-zinc-50 dark:bg-zinc-900/50 rounded-xl p-5 border border-zinc-100 dark:border-zinc-800 mb-2">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                                <span className="w-5 h-5 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                                    <CheckCircle className="w-3 h-3 text-zinc-500" />
                                </span>
                                Project Journey
                            </h3>
                            {isCreator && onAdvanceStage && currentStageIndex < stages.length - 1 && (
                                <button
                                    onClick={onAdvanceStage}
                                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-600 text-white text-[10px] font-semibold hover:bg-indigo-700 transition-colors"
                                >
                                    Advance
                                    <ArrowRight className="w-3 h-3" />
                                </button>
                            )}
                        </div>
                        <div className="relative">
                            <div className="absolute top-3 left-0 right-0 h-0.5 bg-zinc-200 dark:bg-zinc-800 hidden md:block" />
                            <div className="flex flex-col md:flex-row justify-between gap-4 md:gap-0">
                                {stages.map((stage, index) => {
                                    const isCompleted = index < currentStageIndex;
                                    const isCurrent = index === currentStageIndex;

                                    return (
                                        <div key={index} className="relative z-10 flex md:flex-col items-center md:text-center gap-3 md:gap-2 flex-1">
                                            <div className={cn(
                                                "w-6 h-6 rounded-full flex items-center justify-center border-[3px] transition-all duration-300",
                                                isCompleted
                                                    ? "bg-emerald-500 border-emerald-500"
                                                    : isCurrent
                                                        ? "bg-white dark:bg-zinc-900 border-indigo-600 ring-4 ring-indigo-50 dark:ring-indigo-900/20"
                                                        : "bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700"
                                            )}>
                                                {isCompleted ? (
                                                    <CheckCircle className="w-3.5 h-3.5 text-white" />
                                                ) : isCurrent ? (
                                                    <div className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse" />
                                                ) : null}
                                            </div>
                                            <p className={cn(
                                                "text-xs font-semibold",
                                                isCompleted ? "text-emerald-600 dark:text-emerald-400" :
                                                    isCurrent ? "text-indigo-600 dark:text-indigo-400" :
                                                        "text-zinc-400 dark:text-zinc-600"
                                            )}>
                                                {stage.name}
                                            </p>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </section>

                    {/* The Vision (Description) */}
                    {project?.description && (
                        <section>
                            <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-4 flex items-center gap-2">
                                <Zap className="w-4 h-4" />
                                Vision & Description
                            </h3>
                            <div className="prose prose-zinc dark:prose-invert max-w-none">
                                <p className="whitespace-pre-wrap leading-relaxed text-zinc-600 dark:text-zinc-300">
                                    {project.description}
                                </p>
                            </div>
                        </section>
                    )}

                    {/* Problem & Solution Grid */}
                    {(project?.problemStatement || project?.solutionStatement) && (
                        <div className="grid md:grid-cols-2 gap-6">
                            {project.problemStatement && (
                                <div className="h-full p-6 rounded-2xl bg-rose-50/50 dark:bg-rose-900/10 border border-rose-100 dark:border-rose-900/20">
                                    <h3 className="text-sm font-bold text-rose-900 dark:text-rose-100 mb-3">The Problem</h3>
                                    <p className="text-zinc-600 dark:text-zinc-300 text-sm leading-relaxed italic">
                                        {project.problemStatement}
                                    </p>
                                </div>
                            )}
                            {project.solutionStatement && (
                                <div className="h-full p-6 rounded-2xl bg-emerald-50/50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/20">
                                    <h3 className="text-sm font-bold text-emerald-900 dark:text-emerald-100 mb-3">The Solution</h3>
                                    <p className="text-zinc-600 dark:text-zinc-300 text-sm leading-relaxed">
                                        {project.solutionStatement}
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Tech Stack & Links */}
                    <div className="flex flex-wrap items-start gap-12 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                        {project?.tags && project.tags.length > 0 && (
                            <div className="space-y-3">
                                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Tags</h3>
                                <div className="flex flex-wrap gap-2">
                                    {project.tags.map((tag: string) => (
                                        <div key={tag} className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs font-semibold border border-zinc-200 dark:border-zinc-700">
                                            #{tag}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {(project?.skills || project?.technologies_used) && (project.skills || project.technologies_used).length > 0 && (
                            <div className="space-y-3">
                                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Tech Stack</h3>
                                <div className="flex flex-wrap gap-2">
                                    {(project.skills || project.technologies_used).map((tech: string) => (
                                        <div key={tech} className="px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 text-xs font-semibold border border-indigo-200 dark:border-indigo-800">
                                            {tech}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {(project?.github_url || project?.demo_url) && (
                            <div className="space-y-3">
                                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Resources</h3>
                                <div className="flex flex-col gap-2">
                                    {project.github_url && (
                                        <a href={project.github_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline">
                                            <Github className="w-4 h-4" />
                                            Source Code
                                            <ExternalLink className="w-3 h-3 text-zinc-400" />
                                        </a>
                                    )}
                                    {project.demo_url && (
                                        <a href={project.demo_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline">
                                            <ExternalLink className="w-4 h-4" />
                                            Live Demo
                                        </a>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </motion.div>
    );
}
