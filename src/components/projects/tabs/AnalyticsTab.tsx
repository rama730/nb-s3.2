import { useMemo, useState } from "react";
import { BarChart3, TrendingUp, CheckCircle2, Clock, Users, Activity } from "lucide-react";
import { useProjectAnalytics } from "@/hooks/hub/useProjectData";

interface AnalyticsTabProps {
    projectId: string;
    project: any;
}

export default function AnalyticsTab({ projectId, project }: AnalyticsTabProps) {
    const { data: analytics, isLoading } = useProjectAnalytics(projectId);
    const [windowDays, setWindowDays] = useState<7 | 30 | 90>(30);

    // Final stats to display
    const stats = useMemo(() => {
        if (!analytics) return {
            totalTasks: 0,
            completedTasks: 0,
            inProgressTasks: 0,
            overdueTasks: 0,
            completionRate: 0,
            activityByWindow: {
                7: { tasksCreated: 0, tasksCompleted: 0 },
                30: { tasksCreated: 0, tasksCompleted: 0 },
                90: { tasksCreated: 0, tasksCompleted: 0 },
            },
            membersCount: (project?.collaborators?.length || 0),
            viewCount: project?.viewCount || 0,
        };

        return {
            ...analytics,
            membersCount: (project?.collaborators?.length || 0),
            viewCount: project?.viewCount || 0,
        };
    }, [analytics, project]);

    const statCards = useMemo(() => [
        {
            label: "Total Tasks",
            value: stats.totalTasks,
            icon: Activity,
            color: "text-indigo-500",
            bgColor: "bg-indigo-50 dark:bg-indigo-900/20",
        },
        {
            label: "Completed",
            value: stats.completedTasks,
            icon: CheckCircle2,
            color: "text-emerald-500",
            bgColor: "bg-emerald-50 dark:bg-emerald-900/20",
        },
        {
            label: "In Progress",
            value: stats.inProgressTasks,
            icon: TrendingUp,
            color: "text-blue-500",
            bgColor: "bg-blue-50 dark:bg-blue-900/20",
        },
        {
            label: "Overdue",
            value: stats.overdueTasks,
            icon: Clock,
            color: "text-rose-500",
            bgColor: "bg-rose-50 dark:bg-rose-900/20",
        },
    ], [stats.totalTasks, stats.completedTasks, stats.inProgressTasks, stats.overdueTasks]);

    const trendSummary = useMemo(() => {
        const safeWindow = Math.max(1, windowDays);
        const windowActivity = stats.activityByWindow?.[windowDays];
        const tasksCreatedInWindow = typeof windowActivity?.tasksCreated === "number"
            ? windowActivity.tasksCreated
            : null;
        const tasksCompletedInWindow = typeof windowActivity?.tasksCompleted === "number"
            ? windowActivity.tasksCompleted
            : null;
        const tasksPerDay = tasksCreatedInWindow !== null
            ? tasksCreatedInWindow / safeWindow
            : null;
        const completionPerDay = tasksCompletedInWindow !== null
            ? tasksCompletedInWindow / safeWindow
            : null;
        return {
            tasksPerDay: tasksPerDay !== null && Number.isFinite(tasksPerDay) ? tasksPerDay.toFixed(1) : "N/A",
            completionPerDay: completionPerDay !== null && Number.isFinite(completionPerDay) ? completionPerDay.toFixed(1) : "N/A",
        };
    }, [stats.activityByWindow, windowDays]);

    if (isLoading) {
        return (
            <div className="space-y-6 animate-pulse">
                <div className="h-8 w-48 bg-zinc-100 dark:bg-zinc-800 rounded" />
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-zinc-100 dark:bg-zinc-800 rounded-xl" />)}
                </div>
                <div className="h-40 bg-zinc-100 dark:bg-zinc-800 rounded-xl" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Analytics</h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Project performance insights and metrics
                </p>
                <div className="mt-3 inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-1">
                    {[7, 30, 90].map((days) => (
                        <button
                            key={days}
                            onClick={() => setWindowDays(days as 7 | 30 | 90)}
                            className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                                windowDays === days
                                    ? "bg-indigo-600 text-white"
                                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                            }`}
                        >
                            {days}d
                        </button>
                    ))}
                </div>
            </div>

            {/* Stat Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {statCards.map((stat) => (
                    <div
                        key={stat.label}
                        className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4"
                    >
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${stat.bgColor}`}>
                                <stat.icon className={`w-5 h-5 ${stat.color}`} />
                            </div>
                            <div>
                                <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{stat.value}</p>
                                <p className="text-xs text-zinc-500 dark:text-zinc-400">{stat.label}</p>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Completion Progress */}
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        Overall Progress
                    </h3>
                    <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                        {stats.completionRate}%
                    </span>
                </div>
                <div className="h-3 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500"
                        style={{ width: `${stats.completionRate}%` }}
                    />
                </div>
                <div className="flex justify-between mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <span>{stats.completedTasks} completed</span>
                    <span>{stats.totalTasks - stats.completedTasks} remaining</span>
                </div>
                <div className="mt-3 border-t border-zinc-100 dark:border-zinc-800 pt-3 grid grid-cols-2 gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                    <div>
                        <p className="uppercase tracking-wide">Avg tasks/day ({windowDays}d)</p>
                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{trendSummary.tasksPerDay}</p>
                    </div>
                    <div>
                        <p className="uppercase tracking-wide">Avg completed/day</p>
                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{trendSummary.completionPerDay}</p>
                    </div>
                </div>
            </div>

            {/* Project Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <Users className="w-5 h-5 text-indigo-500" />
                        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            Team Size
                        </h3>
                    </div>
                    <p className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
                        {stats.membersCount}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                        Active members
                    </p>
                </div>

                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <BarChart3 className="w-5 h-5 text-indigo-500" />
                        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            Total Views
                        </h3>
                    </div>
                    <p className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
                        {stats.viewCount}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                        Project page views
                    </p>
                </div>
            </div>

            {/* Placeholder for charts */}
            <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-800/20 p-8 text-center">
                <BarChart3 className="w-12 h-12 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Detailed charts and trends coming soon
                </p>
            </div>
        </div>
    );
}
