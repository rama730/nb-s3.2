"use client";

import { Users, FolderKanban, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProfileStatsProps {
    stats: {
        connectionsCount: number;
        projectsCount: number;
        postsCount: number;
    };
}

export default function ProfileStats({ stats }: ProfileStatsProps) {
    const statCards = [
        {
            label: "Connections",
            value: stats.connectionsCount || 0,
            icon: Users,
            color: "from-blue-500 to-cyan-500",
            bgColor: "bg-blue-50 dark:bg-blue-900/20",
            textColor: "text-blue-600 dark:text-blue-400",
        },
        {
            label: "Projects",
            value: stats.projectsCount || 0,
            icon: FolderKanban,
            color: "from-purple-500 to-pink-500",
            bgColor: "bg-purple-50 dark:bg-purple-900/20",
            textColor: "text-purple-600 dark:text-purple-400",
        },
        {
            label: "Posts",
            value: stats.postsCount || 0,
            icon: FileText,
            color: "from-orange-500 to-red-500",
            bgColor: "bg-orange-50 dark:bg-orange-900/20",
            textColor: "text-orange-600 dark:text-orange-400",
        },
    ];

    return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            {statCards.map((stat, index) => {
                const Icon = stat.icon;
                return (
                    <div
                        key={stat.label}
                        className={cn(
                            "rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 hover:shadow-lg transition-all duration-300 cursor-pointer group",
                            "hover:scale-105 hover:-translate-y-1"
                        )}
                        style={{
                            animationDelay: `${index * 100}ms`,
                        }}
                    >
                        <div className="flex items-center justify-between mb-4">
                            <div className={cn("p-3 rounded-xl", stat.bgColor)}>
                                <Icon className={cn("w-6 h-6", stat.textColor)} />
                            </div>
                            <div className={cn("w-12 h-1 rounded-full bg-gradient-to-r opacity-20", stat.color)} />
                        </div>
                        <div className="space-y-1">
                            <p className="text-3xl font-bold text-zinc-900 dark:text-white group-hover:scale-110 transition-transform duration-300">
                                {stat.value.toLocaleString()}
                            </p>
                            <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{stat.label}</p>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
