"use client";

import dynamic from "next/dynamic";
import { SkeletonTasks } from "@/components/projects/skeletons/SkeletonTasks";
import { SkeletonFiles } from "@/components/projects/skeletons/SkeletonFiles";
import { SkeletonSprints } from "@/components/projects/skeletons/SkeletonSprints";

// Generic Skeleton for other tabs
const TabSkeleton = () => (
    <div className="animate-pulse space-y-4">
        <div className="h-8 bg-zinc-200 dark:bg-zinc-800 rounded-lg w-1/3" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="h-48 bg-zinc-200 dark:bg-zinc-800 rounded-2xl" />
            <div className="h-48 bg-zinc-200 dark:bg-zinc-800 rounded-2xl" />
        </div>
        <div className="h-64 bg-zinc-200 dark:bg-zinc-800 rounded-2xl" />
    </div>
);

export const DashboardTab = dynamic(
    () => import("@/components/projects/tabs/DashboardTab"),
    { loading: () => <TabSkeleton />, ssr: true }
);

export const TasksTab = dynamic(
    () => import("@/components/projects/v2/TasksTab"),
    { loading: () => <SkeletonTasks />, ssr: false }
);

export const FilesTab = dynamic(
    () => import("@/components/projects/v2/ProjectFilesWorkspace"),
    { loading: () => <SkeletonFiles />, ssr: false }
);

export const AnalyticsTab = dynamic(
    () => import("@/components/projects/tabs/AnalyticsTab"),
    { loading: () => <TabSkeleton />, ssr: false }
);

export const SprintPlanning = dynamic(
    () => import("@/components/projects/tabs/SprintPlanning"),
    { loading: () => <SkeletonSprints />, ssr: false }
);

export const ProjectSettingsTab = dynamic(
    () => import("@/components/projects/tabs/ProjectSettingsTab"),
    { loading: () => <TabSkeleton />, ssr: false }
);
