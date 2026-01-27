"use client";

import { useMemo } from "react";
import { differenceInDays, eachDayOfInterval, format, isBefore, isSameDay } from "date-fns";
import { TrendingDown, Info, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

interface Sprint {
    id: string;
    startDate: string;
    endDate: string;
    status: string;
    name?: string;
}

interface Task {
    id: string;
    status: string;
    storyPoints?: number | null;
    updatedAt?: string | null;
    createdAt?: string | null;
}

interface BurndownChartProps {
    sprint: Sprint;
    tasks: Task[];
    className?: string;
}

export default function BurndownChart({ sprint, tasks, className }: BurndownChartProps) {
    const chartData = useMemo(() => {
        const startDate = new Date(sprint.startDate);
        const endDate = new Date(sprint.endDate);
        const today = new Date();

        // Generate days
        const days = eachDayOfInterval({ start: startDate, end: endDate });

        // Calculate Initial Scope (Tasks "created" before or on start date)
        // Note: For tasks moved from backlog, createdAt might be old.
        // If we want to show "Added During Sprint", we should look for createdAt > startDate.
        // But since we don't have "assignedAt", we treat ALL tasks filtered into this sprint (by parent) as the scope.
        // To visualize "spikes where sprint was created in that sprint", we use createdAt.
        // If a task was created long ago, it counts towards Initial Scope.
        // If a task was created MID-SPRINT, it counts towards Dynamic Scope (Spike).
        
        const initialTasks = tasks.filter(t => isBefore(new Date(t.createdAt || 0), startDate) || isSameDay(new Date(t.createdAt || 0), startDate));
        const initialPoints = initialTasks.reduce((sum, t) => sum + (t.storyPoints || 1), 0);

        // Calculate ideal decrement per day based on INITIAL scope
        const pointsPerDay = initialPoints / Math.max(days.length - 1, 1);

        const actualData: { date: Date; ideal: number; actual: number | null; scope: number }[] = [];

        days.forEach((day, idx) => {
            // Ideal: Burn from Initial Points to 0
            const ideal = Math.max(0, initialPoints - (pointsPerDay * idx));

            // Calculate Dynamic Scope for this day (Cumulative created tasks up to this day)
            const currentScopeTasks = tasks.filter(t => isBefore(new Date(t.createdAt || 0), day) || isSameDay(new Date(t.createdAt || 0), day));
            const currentScopePoints = currentScopeTasks.reduce((sum, t) => sum + (t.storyPoints || 1), 0);

            // Calculate Actual Remaining
            // Only plot if day is past or today
            let actual: number | null = null;
            if (isBefore(day, today) || isSameDay(day, today)) {
                
                // Completed points for this day
                const completedPoints = tasks
                    .filter(t => {
                        if (t.status !== "done") return false;
                        if (!t.updatedAt) return false;
                        const completedDate = new Date(t.updatedAt);
                        return isBefore(completedDate, day) || isSameDay(completedDate, day);
                    })
                    .reduce((sum, t) => sum + (t.storyPoints || 1), 0);

                // Actual Remaining = Current Scope - Completed
                actual = Math.max(0, currentScopePoints - completedPoints);
            }

            actualData.push({ date: day, ideal, actual, scope: currentScopePoints });
        });

        // Max Y axis should be the Peak Scope
        const maxScope = Math.max(...actualData.map(d => d.scope));
        const maxPoints = maxScope > 0 ? maxScope : 10;

        return {
            days: actualData,
            totalPoints: initialPoints,
            maxPoints,
        };
    }, [sprint, tasks]);

    const chartHeight = 300;
    const chartWidth = 100; // percentage
    const padding = { top: 20, right: 20, bottom: 30, left: 40 };

    // SCALING
    const getX = (index: number) => {
        const availableWidth = chartWidth - padding.left - padding.right;
        const maxIndex = Math.max(chartData.days.length - 1, 1);
        return padding.left + (index / maxIndex) * availableWidth;
    };

    const getY = (value: number) => {
        const availableHeight = chartHeight - padding.top - padding.bottom;
        return padding.top + (1 - (value / chartData.maxPoints)) * availableHeight;
    };

    // PATHS
    const idealPath = chartData.days
        .map((d, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(d.ideal)}`)
        .join(" ");

    const actualPointsList = chartData.days.filter((d) => d.actual !== null);
    const actualPath = actualPointsList
        .map((d, i) => {
            const originalIdx = chartData.days.findIndex(x => x.date === d.date);
            return `${i === 0 ? "M" : "L"} ${getX(originalIdx)} ${getY(d.actual!)}`;
        })
        .join(" ");
    
    // Stats
    const totalDuration = differenceInDays(new Date(sprint.endDate), new Date(sprint.startDate));
    const daysRemaining = Math.max(0, differenceInDays(new Date(sprint.endDate), new Date()));
    const completedInfo = tasks.filter(t => t.status === "done");
    const completedPoints = completedInfo.reduce((sum, t) => sum + (t.storyPoints || 1), 0);
    const totalCurrentPoints = tasks.reduce((sum, t) => sum + (t.storyPoints || 1), 0);
    const progress = totalCurrentPoints > 0 ? Math.round((completedPoints / totalCurrentPoints) * 100) : 0;

    return (
        <div className={cn("rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden", className)}>
            {/* Header */}
            <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-rose-100 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400">
                        <TrendingDown className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Burndown Chart</h3>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Track goal progress & scope</p>
                    </div>
                </div>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-4 gap-4 px-6 py-4 border-b border-zinc-100 dark:border-zinc-800">
                <div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Duration</p>
                    <div className="flex items-center gap-1.5">
                        <Calendar className="w-4 h-4 text-zinc-400" />
                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{totalDuration} days</span>
                    </div>
                </div>
                <div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Remaining</p>
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{daysRemaining} days</span>
                </div>
                <div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Current Scope</p>
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{totalCurrentPoints} points</span>
                </div>
                <div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Velocity</p>
                    <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">{progress}% done</span>
                </div>
            </div>

            {/* Chart Area */}
            <div className="p-6">
                <div className="w-full relative" style={{ height: "300px" }}>
                    <svg
                        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                        preserveAspectRatio="none"
                        className="w-full h-full"
                    >
                        {/* Grid */}
                         {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                            const y = getY(ratio * chartData.maxPoints);
                            return (
                                <line
                                    key={ratio}
                                    x1={padding.left}
                                    x2={chartWidth - padding.right}
                                    y1={y}
                                    y2={y}
                                    stroke="currentColor"
                                    strokeWidth="0.5"
                                    className="text-zinc-100 dark:text-zinc-800"
                                    vectorEffect="non-scaling-stroke"
                                />
                            );
                        })}

                        {/* Ideal Line */}
                        <path
                            d={idealPath}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeDasharray="4,4" // Dashed
                            className="text-zinc-300 dark:text-zinc-600"
                            vectorEffect="non-scaling-stroke"
                        />

                        {/* Actual Remaining Line */}
                        <path
                            d={actualPath}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            className="text-indigo-500"
                            vectorEffect="non-scaling-stroke"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />

                         {/* Points */}
                         {actualPointsList.map((d) => {
                            const originalIdx = chartData.days.findIndex(x => x.date === d.date);
                            return (
                                <circle
                                    key={d.date.toISOString()}
                                    cx={getX(originalIdx)}
                                    cy={getY(d.actual!)}
                                    r="3"
                                    fill="white"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    className="text-indigo-600"
                                />
                            );
                        })}
                    </svg>

                     {/* Y-Axis */}
                     <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-between py-[20px] text-[10px] text-zinc-400 w-[30px] text-right pr-2">
                        <span>{chartData.maxPoints}</span>
                        <span>{Math.round(chartData.maxPoints / 2)}</span>
                        <span>0</span>
                    </div>

                    {/* X-Axis */}
                    <div className="absolute left-[40px] right-[20px] bottom-0 flex justify-between text-[10px] text-zinc-400 translate-y-4">
                        <span>{format(new Date(sprint.startDate), "MMM d")}</span>
                        <span>{format(new Date(sprint.endDate), "MMM d")}</span>
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
                <div className="flex items-start gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <Info className="w-4 h-4 shrink-0 mt-0.5" />
                    <p>
                        Dashed line = Ideal. Solid line = Actual Remaining. An upward spike (jump) in the solid line means new tasks were added to the goal.
                    </p>
                </div>
            </div>
        </div>
    );
}
