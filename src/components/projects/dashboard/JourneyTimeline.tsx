"use client";

import { memo, useState, useEffect, useRef, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, CheckCircle, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { useReducedMotionPreference } from "@/components/providers/theme-provider";

const FALLBACK_NOW = Date.now();
const FALLBACK_START = FALLBACK_NOW - 30 * 24 * 60 * 60 * 1000;

interface JourneyTimelineProps {
    stages: string[];
    currentStageIndex: number;
    isCreator: boolean;
    onAdvanceStage?: () => void;
    onRedoStage?: () => void;
    createdAt?: string;
    updatedAt?: string;
    stageCompletionDates?: Record<string, string>;
    hasAnimated: boolean;
    onAnimationComplete: () => void;
}

export const JourneyTimeline = memo(function JourneyTimeline({
    stages,
    currentStageIndex,
    isCreator,
    onAdvanceStage,
    onRedoStage,
    createdAt,
    updatedAt,
    stageCompletionDates = {},
    hasAnimated,
    onAnimationComplete,
}: JourneyTimelineProps) {
    const reduceMotion = useReducedMotionPreference();
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [timelineWidth, setTimelineWidth] = useState(0);

    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const updateWidth = () => {
            const flexRow = container.querySelector(".flex-row");
            if (flexRow) {
                setTimelineWidth(flexRow.scrollWidth);
            }
        };

        updateWidth();

        const observer = new ResizeObserver(updateWidth);
        observer.observe(container);
        return () => observer.disconnect();
    }, [stages.length]);

    // Scroll active item into view on stage changes
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container || currentStageIndex <= 2) return;

        const scrollTimer = setTimeout(() => {
            // Find active stage item dynamically using data-stage-index
            const activeChild = container.querySelector(`[data-stage-index="${currentStageIndex}"]`) as HTMLElement;

            if (activeChild) {
                const targetScrollLeft = activeChild.offsetLeft - (container.clientWidth / 2) + (activeChild.clientWidth / 2);
                container.scrollTo({
                    left: targetScrollLeft,
                    behavior: "smooth",
                });
            }
        }, 1100);

        return () => clearTimeout(scrollTimer);
    }, [currentStageIndex]);

    const containerStyle = useMemo(() => {
        if (stages.length > 5) {
            return {
                width: `${(stages.length / 5) * 100}%`,
            };
        }
        return {};
    }, [stages.length]);

    const getStageCenterPercent = useCallback((index: number) => {
        const total = stages.length || 1;
        return `${((index + 0.5) / total) * 100}%`;
    }, [stages.length]);

    const travelKeyframesPx = useMemo(() => {
        const points: number[] = [];
        for (let i = 0; i <= currentStageIndex; i++) {
            points.push((i / (stages.length || 1)) * timelineWidth);
        }
        return points;
    }, [currentStageIndex, stages.length, timelineWidth]);

    const getStageCompletionDate = useCallback((index: number) => {
        const dateStr = stageCompletionDates[String(index)];
        if (dateStr) {
            return new Date(dateStr).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric"
            });
        }

        // Linear fallback
        const start = createdAt ? new Date(createdAt).getTime() : FALLBACK_START;
        const end = updatedAt ? new Date(updatedAt).getTime() : FALLBACK_NOW;

        let time: number;
        if (currentStageIndex > 0) {
            const totalStages = currentStageIndex;
            const progressRatio = (index + 1) / (totalStages + 1);
            time = start + (end - start) * progressRatio;
        } else {
            time = start;
        }

        return new Date(time).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric"
        });
    }, [stageCompletionDates, createdAt, updatedAt, currentStageIndex]);

    return (
        <section className="bg-zinc-50 dark:bg-zinc-900/50 rounded-xl p-5 border border-zinc-100 dark:border-zinc-800 mb-2">
            <TooltipProvider>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                            <CheckCircle className="w-3 h-3 text-zinc-500" />
                        </span>
                        Journey
                    </h3>
                    {isCreator && (
                        <div className="flex items-center gap-2">
                            {onRedoStage && (
                                <button
                                    onClick={onRedoStage}
                                    disabled={currentStageIndex === 0}
                                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-650 dark:text-zinc-300 text-[10px] font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <ArrowLeft className="w-3 h-3" />
                                    Redo
                                </button>
                            )}
                            {onAdvanceStage && (
                                <button
                                    onClick={onAdvanceStage}
                                    disabled={currentStageIndex >= stages.length - 1}
                                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md app-accent-solid text-[10px] font-semibold hover:bg-primary/90 transition-[background-color,box-shadow] disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Advance
                                    <ArrowRight className="w-3 h-3" />
                                </button>
                            )}
                        </div>
                    )}
                </div>
                <div
                    ref={scrollContainerRef}
                    className="relative overflow-x-auto app-scroll app-scroll-hidden select-none"
                >
                    <div
                        className="flex flex-row items-center justify-between relative min-w-full"
                        style={containerStyle}
                    >
                        {/* Background Line */}
                        <div
                            className="absolute top-[13px] h-0.5 bg-zinc-200 dark:bg-zinc-800 z-0"
                            style={{
                                left: getStageCenterPercent(0),
                                width: `calc(${getStageCenterPercent(stages.length - 1)} - ${getStageCenterPercent(0)})`,
                            }}
                        />
                        {/* Progress Line (scaleX GPU Accelerated) */}
                        {currentStageIndex > 0 && (
                            <motion.div
                                initial={hasAnimated ? { scaleX: currentStageIndex / (stages.length - 1 || 1) } : { scaleX: 0 }}
                                animate={{ scaleX: currentStageIndex / (stages.length - 1 || 1) }}
                                transition={hasAnimated ? { duration: 0.3, ease: "easeInOut" } : {
                                    duration: currentStageIndex * 0.25,
                                    ease: "easeInOut"
                                }}
                                className="absolute top-[13px] h-0.5 bg-primary origin-left z-10"
                                style={{
                                    left: getStageCenterPercent(0),
                                    width: `calc(${getStageCenterPercent(stages.length - 1)} - ${getStageCenterPercent(0)})`,
                                }}
                            />
                        )}
                        {/* Traveling Glow Dot (translateX GPU Accelerated) */}
                        {currentStageIndex > 0 && timelineWidth > 0 && (
                            <motion.div
                                initial={hasAnimated ? { x: (currentStageIndex / stages.length) * timelineWidth } : { x: 0 }}
                                animate={{
                                    x: hasAnimated
                                        ? (currentStageIndex / stages.length) * timelineWidth
                                        : travelKeyframesPx
                                }}
                                onAnimationComplete={onAnimationComplete}
                                transition={hasAnimated ? { duration: 0.3, ease: "easeInOut" } : {
                                    duration: currentStageIndex * 0.25,
                                    ease: "easeInOut"
                                }}
                                className="absolute top-[11px] w-1.5 h-1.5 -ml-[3px] rounded-full bg-primary shadow-[0_0_8px_var(--primary)] z-20 pointer-events-none"
                                style={{
                                    left: getStageCenterPercent(0),
                                }}
                            />
                        )}
                        {stages.map((stage: string, index: number) => {
                            const isCompleted = index < currentStageIndex;
                            const isCurrent = index === currentStageIndex;

                            const widthClass = stages.length > 5
                                ? "flex-shrink-0"
                                : "flex-1";

                            const childStyle = stages.length > 5
                                ? {
                                      width: `${100 / stages.length}%`,
                                      minWidth: `${100 / stages.length}%`,
                                      maxWidth: `${100 / stages.length}%`,
                                  }
                                : {};

                            const stageItem = (
                                <div
                                    key={index}
                                    data-stage-index={index}
                                    className={cn("relative z-10 flex flex-col items-center text-center gap-2 py-0.5", widthClass)}
                                    style={childStyle}
                                >
                                    <div className={cn(
                                        "w-6 h-6 rounded-full flex items-center justify-center border-[3px] transition-all duration-300 bg-white dark:bg-zinc-900",
                                        isCompleted
                                            ? "bg-primary border-primary dark:bg-primary text-white"
                                            : isCurrent
                                                ? "border-primary"
                                                : "border-zinc-300 dark:border-zinc-700"
                                    )}>
                                        {isCompleted ? (
                                            <Check className="w-3.5 h-3.5 text-white" />
                                        ) : isCurrent ? (
                                            <div
                                                className={cn(
                                                    "w-2 h-2 rounded-full bg-primary motion-reduce:animate-none",
                                                    !reduceMotion && "motion-safe:animate-pulse",
                                                )}
                                            />
                                        ) : null}
                                    </div>
                                    <p className={cn(
                                        "text-xs font-semibold px-2 truncate w-full",
                                        isCompleted ? "text-zinc-700 dark:text-zinc-350 font-medium" :
                                            isCurrent ? "text-primary" :
                                                "text-zinc-400 dark:text-zinc-600"
                                    )}>
                                        {stage}
                                    </p>
                                </div>
                            );

                            if (isCompleted) {
                                return (
                                    <Tooltip key={index} delayDuration={150}>
                                        <TooltipTrigger asChild>
                                            {stageItem}
                                        </TooltipTrigger>
                                        <TooltipContent className="bg-zinc-900 text-white border-zinc-800 text-[10px] px-2 py-1 rounded shadow-md z-50">
                                            Finished on {getStageCompletionDate(index)}
                                        </TooltipContent>
                                    </Tooltip>
                                );
                            }

                            return stageItem;
                        })}
                    </div>
                </div>
            </TooltipProvider>
        </section>
    );
}, (prev, next) => {
    // Render optimization check
    return prev.currentStageIndex === next.currentStageIndex &&
           prev.stages.join(",") === next.stages.join(",") &&
           prev.isCreator === next.isCreator &&
           prev.createdAt === next.createdAt &&
           prev.updatedAt === next.updatedAt &&
           prev.hasAnimated === next.hasAnimated &&
           JSON.stringify(prev.stageCompletionDates) === JSON.stringify(next.stageCompletionDates);
});

export default JourneyTimeline;
