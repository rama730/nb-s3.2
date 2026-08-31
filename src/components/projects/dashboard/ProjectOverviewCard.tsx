"use client";

import { Lock, Zap } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { SkillList } from "@/components/skills/SkillList";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import JourneyTimeline from "./JourneyTimeline";

interface ProjectOverviewCardProps {
    project: any;
    isCreator: boolean;
    lifecycleStages: { name: string; status: string }[];
    currentStageIndex: number;
    onAdvanceStage: () => void;
    onRedoStage?: () => void;
}

function StatementBox({
    title,
    content,
    tone,
    onOpen,
}: {
    title: string;
    content: string;
    tone: "problem" | "solution";
    onOpen: () => void;
}) {
    const problem = tone === "problem";
    return (
        <button
            type="button"
            onClick={onOpen}
            className={problem
                ? "flex h-full min-h-44 w-full flex-col rounded-2xl border border-rose-100 bg-rose-50/50 p-6 text-left transition hover:border-rose-200 hover:bg-rose-50 focus-visible:outline-none   dark:border-rose-900/20 dark:bg-rose-900/10 dark:hover:border-rose-800"
                : "flex h-full min-h-44 w-full flex-col rounded-2xl border border-emerald-100 bg-emerald-50/50 p-6 text-left transition hover:border-emerald-200 hover:bg-emerald-50 focus-visible:outline-none   dark:border-emerald-900/20 dark:bg-emerald-900/10 dark:hover:border-emerald-800"}
        >
            <h3 className={problem
                ? "mb-3 text-sm font-bold text-rose-900 dark:text-rose-100"
                : "mb-3 text-sm font-bold text-emerald-900 dark:text-emerald-100"}
            >
                {title}
            </h3>
            <p className={problem
                ? "line-clamp-6 whitespace-pre-wrap text-sm italic leading-relaxed text-zinc-600 dark:text-zinc-300"
                : "line-clamp-6 whitespace-pre-wrap text-sm leading-relaxed text-zinc-600 dark:text-zinc-300"}
            >
                {content}
            </p>
            <span className="mt-auto pt-4 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Click to read full text</span>
        </button>
    );
}

type StatementSelection = {
    title: string;
    content: string;
    tone: "problem" | "solution";
} | null;

function normalizeProjectSkills(project: any) {
    const values = [
        ...(Array.isArray(project?.skills) ? project.skills : []),
        ...(Array.isArray(project?.technologies_used) ? project.technologies_used : []),
        ...(Array.isArray(project?.technologiesUsed) ? project.technologiesUsed : []),
        ...(Array.isArray(project?.techStack) ? project.techStack : []),
    ];
    return Array.from(new Set(values.filter((skill): skill is string => typeof skill === "string" && skill.trim().length > 0).map((skill) => skill.trim())));
}

const ProjectOverviewCard = memo(function ProjectOverviewCard({
    project,
    isCreator,
    lifecycleStages,
    currentStageIndex,
    onAdvanceStage,
    onRedoStage,
}: ProjectOverviewCardProps) {
    const [statement, setStatement] = useState<StatementSelection>(null);
    const stages = lifecycleStages.map((stage: any) => stage?.name ?? stage).filter(Boolean);
    const projectSkills = useMemo(() => normalizeProjectSkills(project), [project]);

    return (
        <div className="flex h-fit flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="p-8">
                <div className="relative z-10 mb-4 flex items-start justify-between gap-4">
                    <h1 className="flex-1 truncate text-3xl font-extrabold leading-tight tracking-tight text-zinc-900 dark:text-zinc-50">
                        {project?.title}
                    </h1>
                    <div className="flex shrink-0 items-center gap-2">
                        {(project?.category || project?.project_type || project?.custom_project_type) ? (
                            <span className="rounded-lg border border-zinc-200 bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-650 select-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                                {String(project.category || project.custom_project_type || project.project_type)
                                    .split(/[_-]+/)
                                    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                                    .join(" ")}
                            </span>
                        ) : null}
                        {project?.visibility === "private" ? (
                            <span className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-650 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-405">
                                <Lock className="h-3 w-3" />
                                Private
                            </span>
                        ) : null}
                    </div>
                </div>

                {project?.shortDescription ? (
                    <div className="mb-8">
                        <p className="max-w-3xl text-base font-medium leading-relaxed text-zinc-500 dark:text-zinc-400">
                            {project.shortDescription}
                        </p>
                    </div>
                ) : null}

                <div className="grid grid-cols-1 gap-8">
                    {stages.length > 0 ? (
                        <JourneyTimeline
                            stages={stages}
                            currentStageIndex={currentStageIndex}
                            isCreator={isCreator}
                            onAdvanceStage={onAdvanceStage}
                            onRedoStage={onRedoStage}
                            stageCompletionDates={project?.stageCompletionDates}
                        />
                    ) : null}

                    {project?.description ? (
                        <section>
                            <h3 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                                <Zap className="h-4 w-4" />
                                Vision & Description
                            </h3>
                            <p className="whitespace-pre-wrap leading-relaxed text-zinc-600 dark:text-zinc-300">
                                {project.description}
                            </p>
                        </section>
                    ) : null}

                    {(project?.problemStatement || project?.solutionStatement) ? (
                        <div className="grid items-stretch gap-6 md:grid-cols-2">
                            {project.problemStatement ? (
                                <StatementBox
                                    title="The Problem"
                                    content={project.problemStatement}
                                    tone="problem"
                                    onOpen={() => setStatement({ title: "The Problem", content: project.problemStatement, tone: "problem" })}
                                />
                            ) : null}
                            {project.solutionStatement ? (
                                <StatementBox
                                    title="The Solution"
                                    content={project.solutionStatement}
                                    tone="solution"
                                    onOpen={() => setStatement({ title: "The Solution", content: project.solutionStatement, tone: "solution" })}
                                />
                            ) : null}
                        </div>
                    ) : null}

                    <div className="flex flex-wrap items-start gap-12 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                        {project?.tags?.length > 0 ? (
                            <div className="space-y-3">
                                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Tags</h3>
                                <div className="flex flex-wrap gap-2">
                                    {project.tags.map((tag: string) => (
                                        <div key={tag} className="rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                                            #{tag}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        {projectSkills.length > 0 ? (
                            <div className="space-y-3">
                                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Skills & Tech</h3>
                                <SkillList skills={projectSkills} maxVisible={12} size="sm" />
                            </div>
                        ) : null}

                    </div>
                </div>
            </div>
            <Dialog open={Boolean(statement)} onOpenChange={(open) => !open && setStatement(null)}>
                <DialogContent className="max-h-[min(80vh,42rem)] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className={statement?.tone === "problem" ? "text-rose-900 dark:text-rose-100" : "text-emerald-900 dark:text-emerald-100"}>
                            {statement?.title}
                        </DialogTitle>
                    </DialogHeader>
                    <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-700 dark:text-zinc-300">
                        {statement?.content}
                    </p>
                </DialogContent>
            </Dialog>
        </div>
    );
});

export default ProjectOverviewCard;
