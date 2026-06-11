"use client";

import { Share2, Lock, Github, ExternalLink, Zap, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { memo, useState, useEffect, useRef } from "react";
import { useReducedMotionPreference } from "@/components/providers/theme-provider";
import JourneyTimeline from "./JourneyTimeline";

interface ProjectOverviewCardProps {
    project: any;
    isCreator: boolean;
    membersCount: number;
    hideActionBar?: boolean;
    onShare: () => void;
    lifecycleStages: { name: string; status: string }[];
    currentStageIndex: number;
    onAdvanceStage: () => void;
    onRedoStage?: () => void;
    timelineHasAnimated: boolean;
    setTimelineHasAnimated: (val: boolean) => void;
}

interface TextOverflowBoxProps {
    title: string;
    content: string;
    type: "problem" | "solution";
    onShowMore: () => void;
}

const TextOverflowBox = memo(function TextOverflowBox({ title, content, type, onShowMore }: TextOverflowBoxProps) {
    const textRef = useRef<HTMLDivElement>(null);
    const [hasOverflow, setHasOverflow] = useState(false);

    useEffect(() => {
        const el = textRef.current;
        if (el) {
            setHasOverflow(el.scrollHeight > el.clientHeight);
        }
    }, [content]);

    const isProblem = type === "problem";
    const bgClass = isProblem
        ? "bg-rose-50/50 dark:bg-rose-900/10 border-rose-100 dark:border-rose-900/20"
        : "bg-emerald-50/50 dark:bg-emerald-900/10 border-emerald-100 dark:border-emerald-900/20";
    const titleColor = isProblem ? "text-rose-900 dark:text-rose-100" : "text-emerald-900 dark:text-emerald-100";
    const fadeBgClass = isProblem
        ? "from-[#fff8f9] via-[#fff8f9]/50 dark:from-[#23181e] dark:via-[#23181e]/50 to-transparent"
        : "from-[#f6fefa] via-[#f6fefa]/50 dark:from-[#161d1e] dark:via-[#161d1e]/50 to-transparent";

    const hoverBorderClass = isProblem
        ? "hover:border-rose-300 dark:hover:border-rose-800/60"
        : "hover:border-emerald-300 dark:hover:border-emerald-800/60";

    return (
        <div
            onClick={onShowMore}
            className={cn(
                "relative p-6 rounded-2xl border flex flex-col h-[220px] overflow-hidden cursor-pointer transition-all duration-300 hover:scale-[1.01] hover:shadow-md select-none",
                bgClass,
                hoverBorderClass
            )}
        >
            <h3 className={cn("text-sm font-bold mb-3 shrink-0", titleColor)}>{title}</h3>
            <div ref={textRef} className="flex-1 overflow-hidden relative">
                <p className={cn("text-zinc-600 dark:text-zinc-300 text-sm leading-relaxed whitespace-pre-line", isProblem && "italic")}>
                    {content}
                </p>
                {hasOverflow && (
                    <div className={cn("absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t to-transparent pointer-events-none z-10", fadeBgClass)} />
                )}
            </div>
        </div>
    );
});

function renderFormattedText(text: string) {
    if (!text) return null;
    const lines = text.split("\n");
    const rendered: React.ReactNode[] = [];
    let currentList: React.ReactNode[] = [];
    let listKey = 0;

    lines.forEach((line, index) => {
        const trimmed = line.trim();
        const isBullet = trimmed.startsWith("•") || trimmed.startsWith("-") || trimmed.startsWith("*");
        
        if (isBullet) {
            const content = trimmed.substring(1).trim();
            currentList.push(
                <li key={`li-${index}`} className="ml-4 list-disc pl-1 text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
                    {content}
                </li>
            );
        } else {
            if (currentList.length > 0) {
                rendered.push(
                    <ul key={`list-${listKey++}`} className="space-y-1.5 my-3">
                        {currentList}
                    </ul>
                );
                currentList = [];
            }
            if (trimmed) {
                rendered.push(
                    <p key={`p-${index}`} className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed mb-3">
                        {line}
                    </p>
                );
            }
        }
    });

    if (currentList.length > 0) {
        rendered.push(
            <ul key={`list-${listKey++}`} className="space-y-1.5 my-3">
                {currentList}
            </ul>
        );
    }

    return rendered;
}

const ProjectOverviewCard = memo(function ProjectOverviewCard({
    project,
    isCreator,
    membersCount,
    hideActionBar,
    onShare,
    lifecycleStages,
    currentStageIndex,
    onAdvanceStage,
    onRedoStage,
    timelineHasAnimated,
    setTimelineHasAnimated,
}: ProjectOverviewCardProps) {
    const reduceMotion = useReducedMotionPreference();
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setIsDetailModalOpen(false);
            }
        };
        if (isDetailModalOpen) {
            window.addEventListener("keydown", handleKeyDown);
        }
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [isDetailModalOpen]);

    const projectStages =
        Array.isArray(project?.lifecycleStages) && project.lifecycleStages.length > 0
            ? project.lifecycleStages
            : Array.isArray(project?.lifecycle_stages) && project.lifecycle_stages.length > 0
                ? project.lifecycle_stages
                : null;

    const stages: string[] = (lifecycleStages && lifecycleStages.length > 0)
        ? lifecycleStages.map((s: any) => s?.name ?? s).filter(Boolean)
        : (projectStages || [
            "Discovery",
            "Design",
            "MVP Build",
            "Beta",
            "Launch & Iterate",
        ]);



    const statusColors: Record<string, string> = {
        planning: "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
        in_progress: "bg-primary/10 text-primary border-primary/15",
        completed: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800",
    };

    const statusLabels: Record<string, string> = {
        planning: "Planning",
        in_progress: "In Progress",
        completed: "Completed",
    };

    return (
        <>
            <motion.div
                className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden flex flex-col h-fit"
                initial={false}
                animate={{ opacity: 1, y: 0 }}
                transition={reduceMotion ? { duration: 0 } : { duration: 0.4 }}
            >
            <div className="p-8">
                {/* Header: Title & Badges */}
                <div className="flex items-start justify-between gap-4 mb-4 relative z-10">
                    <h1 className="text-3xl font-extrabold text-zinc-900 dark:text-zinc-50 tracking-tight leading-tight flex-1 truncate">
                        {project?.title}
                    </h1>
                    <div className="flex items-center gap-2 shrink-0">
                        {(project?.category || project?.project_type || project?.custom_project_type) && (
                            <span className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-650 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 select-none">
                                {String(project.category || project.custom_project_type || project.project_type)
                                    .split(/[_-]+/)
                                    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                                    .join(" ")}
                            </span>
                        )}
                        {project?.visibility === "private" && (
                            <span className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-650 dark:text-zinc-405 border border-zinc-200 dark:border-zinc-700">
                                <Lock className="w-3 h-3" />
                                Private
                            </span>
                        )}
                    </div>
                </div>

                {/* Hero Section: Tagline */}
                {project?.shortDescription && (
                    <div className="mb-8">
                        <p className="text-base text-zinc-500 dark:text-zinc-400 font-medium leading-relaxed max-w-3xl">
                            {project.shortDescription}
                        </p>
                    </div>
                )}

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
                    {/* Journey (Timeline) */}
                    {/* Journey (Timeline) */}
                    <JourneyTimeline
                        stages={stages}
                        currentStageIndex={currentStageIndex}
                        isCreator={isCreator}
                        onAdvanceStage={onAdvanceStage}
                        onRedoStage={onRedoStage}
                        createdAt={project?.createdAt}
                        updatedAt={project?.updatedAt}
                        stageCompletionDates={project?.stageCompletionDates}
                        hasAnimated={timelineHasAnimated}
                        onAnimationComplete={() => setTimelineHasAnimated(true)}
                    />

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
                                <TextOverflowBox
                                    title="The Problem"
                                    content={project.problemStatement}
                                    type="problem"
                                    onShowMore={() => setIsDetailModalOpen(true)}
                                />
                            )}
                            {project.solutionStatement && (
                                <TextOverflowBox
                                    title="The Solution"
                                    content={project.solutionStatement}
                                    type="solution"
                                    onShowMore={() => setIsDetailModalOpen(true)}
                                />
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
                                        <div key={tech} className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-semibold border border-primary/15">
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
                                        <a href={project.github_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:text-primary hover:underline">
                                            <Github className="w-4 h-4" />
                                            Source Code
                                            <ExternalLink className="w-3 h-3 text-zinc-400" />
                                        </a>
                                    )}
                                    {project.demo_url && (
                                        <a href={project.demo_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:text-primary hover:underline">
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

        <AnimatePresence>
            {isDetailModalOpen && (
                <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 md:p-6 overflow-hidden">
                    {/* Backdrop */}
                    <motion.div
                        className="absolute inset-0 bg-black/60 backdrop-blur-md"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setIsDetailModalOpen(false)}
                    />

                    {/* Modal Container */}
                    <motion.div
                        className="relative z-10 w-full max-w-4xl max-h-[85vh] rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl flex flex-col overflow-hidden"
                        initial={reduceMotion ? { opacity: 0 } : { scale: 0.95, opacity: 0 }}
                        animate={reduceMotion ? { opacity: 1 } : { scale: 1, opacity: 1 }}
                        exit={reduceMotion ? { opacity: 0 } : { scale: 0.95, opacity: 0 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
                            <div>
                                <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Problem & Solution Statements</h2>
                            </div>
                            <button
                                onClick={() => setIsDetailModalOpen(false)}
                                className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-850 dark:hover:text-zinc-200 transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Scrollable Content */}
                        <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">
                            <div className="flex flex-col gap-6 max-w-3xl mx-auto">
                                {/* Problem Box */}
                                {project?.problemStatement && (
                                    <div className="p-6 rounded-2xl bg-rose-50/50 dark:bg-rose-900/10 border border-rose-100 dark:border-rose-900/20 w-full">
                                        <h3 className="text-xs font-bold text-rose-900 dark:text-rose-100 mb-3 uppercase tracking-wider">The Problem</h3>
                                        <div className="italic">
                                            {renderFormattedText(project.problemStatement)}
                                        </div>
                                    </div>
                                )}

                                {/* Solution Box */}
                                {project?.solutionStatement && (
                                    <div className="p-6 rounded-2xl bg-emerald-50/50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/20 w-full">
                                        <h3 className="text-xs font-bold text-emerald-900 dark:text-emerald-100 mb-3 uppercase tracking-wider">The Solution</h3>
                                        <div>
                                            {renderFormattedText(project.solutionStatement)}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    </>
    );
});

export default ProjectOverviewCard;
