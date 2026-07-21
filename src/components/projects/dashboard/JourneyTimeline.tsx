"use client";

import { memo, useEffect, useRef } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

interface JourneyTimelineProps {
    stages: string[];
    currentStageIndex: number;
    isCreator: boolean;
    onAdvanceStage?: () => void;
    onRedoStage?: () => void;
    stageCompletionDates?: Record<string, string>;
}

export const JOURNEY_VISIBLE_STAGE_COUNT = 5;

export function getJourneyStageWindow(stageCount: number, currentStageIndex: number) {
    const count = Math.max(0, Math.trunc(Number.isFinite(stageCount) ? stageCount : 0));
    const visibleCount = Math.min(JOURNEY_VISIBLE_STAGE_COUNT, count);
    const lastIndex = Math.max(0, count - 1);
    const safeCurrentStageIndex = Math.min(Math.max(0, Math.trunc(Number.isFinite(currentStageIndex) ? currentStageIndex : 0)), lastIndex);
    const start = count <= visibleCount
        ? 0
        : Math.min(Math.max(safeCurrentStageIndex - Math.floor(visibleCount / 2), 0), count - visibleCount);

    return {
        start,
        end: start + visibleCount,
        currentStageIndex: safeCurrentStageIndex,
    };
}

function formatStageDate(value?: string) {
    if (!value) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

export const JourneyTimeline = memo(function JourneyTimeline({
    stages,
    currentStageIndex,
    isCreator,
    onAdvanceStage,
    onRedoStage,
    stageCompletionDates = {},
}: JourneyTimelineProps) {
    const lastIndex = Math.max(0, stages.length - 1);
    const stageWindow = getJourneyStageWindow(stages.length, currentStageIndex);
    const safeCurrentStageIndex = stageWindow.currentStageIndex;
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const timelineWidth = stages.length > JOURNEY_VISIBLE_STAGE_COUNT ? `${(stages.length / JOURNEY_VISIBLE_STAGE_COUNT) * 100}%` : undefined;
    const timelineMinWidth = stages.length > JOURNEY_VISIBLE_STAGE_COUNT ? `${stages.length * 7}rem` : undefined;

    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        if (stages.length <= JOURNEY_VISIBLE_STAGE_COUNT) {
            container.scrollLeft = 0;
            return;
        }

        const firstVisibleStage = container.querySelector<HTMLElement>(`[data-stage-index="${stageWindow.start}"]`);
        if (firstVisibleStage) container.scrollLeft = firstVisibleStage.offsetLeft;
    }, [stageWindow.start, stages.length]);

    return (
        <section className="mb-2 rounded-xl border border-zinc-100 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-900/50">
            <TooltipPrimitive.Provider>
                <div className="mb-4 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
                            <CheckCircle className="h-3 w-3 text-zinc-500" />
                        </span>
                        Journey
                    </h3>
                    {isCreator ? (
                        <div className="flex items-center gap-2">
                            {onRedoStage ? (
                                <button
                                    type="button"
                                    onClick={onRedoStage}
                                    disabled={safeCurrentStageIndex === 0}
                                    className="flex items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1 text-[10px] font-semibold text-zinc-650 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                                >
                                    <ArrowLeft className="h-3 w-3" />
                                    Redo
                                </button>
                            ) : null}
                            {onAdvanceStage ? (
                                <button
                                    type="button"
                                    onClick={onAdvanceStage}
                                    disabled={safeCurrentStageIndex >= lastIndex}
                                    className="app-accent-solid flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-semibold transition-[background-color,box-shadow] hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Advance
                                    <ArrowRight className="h-3 w-3" />
                                </button>
                            ) : null}
                        </div>
                    ) : null}
                </div>

                <div ref={scrollContainerRef} className="app-scroll app-scroll-x app-scroll-hidden relative pb-2 select-none">
                    <div
                        className="relative grid min-w-full gap-0"
                        style={{
                            gridTemplateColumns: `repeat(${Math.max(1, stages.length)}, minmax(7rem, 1fr))`,
                            width: timelineWidth,
                            minWidth: timelineMinWidth,
                        }}
                    >
                        {stages.map((stage, index) => {
                            const isCompleted = index < safeCurrentStageIndex;
                            const isCurrent = index === safeCurrentStageIndex;
                            const hasPrevious = index > 0;
                            const hasNext = index < lastIndex;
                            const completedAt = isCompleted ? formatStageDate(stageCompletionDates[String(index)]) : null;
                            const stageItem = (
                                <div key={index} data-stage-index={index} className="relative z-10 flex min-w-0 flex-col items-center gap-2 py-0.5 text-center">
                                    {hasPrevious ? (
                                        <span
                                            aria-hidden="true"
                                            className={cn(
                                                "absolute left-0 right-1/2 top-[13px] z-0 h-0.5 transition-colors",
                                                index <= safeCurrentStageIndex
                                                    ? "bg-primary"
                                                    : "bg-zinc-200 dark:bg-zinc-800",
                                            )}
                                        />
                                    ) : null}
                                    {hasNext ? (
                                        <span
                                            aria-hidden="true"
                                            className={cn(
                                                "absolute left-1/2 right-0 top-[13px] z-0 h-0.5 transition-colors",
                                                index < safeCurrentStageIndex
                                                    ? "bg-primary"
                                                    : "bg-zinc-200 dark:bg-zinc-800",
                                            )}
                                        />
                                    ) : null}
                                    <div
                                        className={cn(
                                            "relative z-10 flex h-6 w-6 items-center justify-center rounded-full border-[3px] bg-white transition-colors dark:bg-zinc-900",
                                            isCompleted
                                                ? "border-primary bg-primary text-white dark:bg-primary"
                                                : isCurrent
                                                    ? "border-primary"
                                                    : "border-zinc-300 dark:border-zinc-700",
                                        )}
                                    >
                                        {isCompleted ? (
                                            <Check className="h-3.5 w-3.5 text-white" />
                                        ) : isCurrent ? (
                                            <div className="h-2 w-2 rounded-full bg-primary motion-safe:animate-pulse motion-reduce:animate-none" />
                                        ) : null}
                                    </div>
                                    <p
                                        className={cn(
                                            "w-full truncate px-2 text-xs font-semibold",
                                            isCompleted
                                                ? "font-medium text-zinc-700 dark:text-zinc-350"
                                                : isCurrent
                                                    ? "text-primary"
                                                    : "text-zinc-400 dark:text-zinc-600",
                                        )}
                                    >
                                        {stage}
                                    </p>
                                </div>
                            );

                            return completedAt ? (
                                <TooltipPrimitive.Root key={index} delayDuration={150}>
                                    <TooltipPrimitive.Trigger asChild>{stageItem}</TooltipPrimitive.Trigger>
                                    <TooltipPrimitive.Content className="z-50 rounded bg-zinc-900 px-2 py-1 text-[10px] text-white shadow-md">
                                        Finished on {completedAt}
                                    </TooltipPrimitive.Content>
                                </TooltipPrimitive.Root>
                            ) : (
                                stageItem
                            );
                        })}
                    </div>
                </div>
            </TooltipPrimitive.Provider>
        </section>
    );
});

export default JourneyTimeline;
