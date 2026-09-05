"use client";

import dynamic from "next/dynamic";
import DashboardTab from "@/components/projects/tabs/DashboardTab";
import { SkeletonTasks } from "@/components/projects/skeletons/SkeletonTasks";
import { SkeletonFiles } from "@/components/projects/skeletons/SkeletonFiles";
import { SkeletonSprints } from "@/components/projects/skeletons/SkeletonSprints";
import { SkeletonSettings } from "@/components/projects/skeletons/SkeletonSettings";
import { SkeletonAnalytics } from "@/components/projects/skeletons/SkeletonAnalytics";
import { SkeletonDoc } from "@/components/projects/skeletons/SkeletonDoc";

const SkeletonUpdates = () => (
    <div className="grid w-full max-w-none gap-8 xl:grid-cols-[minmax(0,760px)_minmax(400px,1fr)]">
        <main className="min-w-0 animate-pulse">
            <div className="px-1 pb-3 pt-2">
                <div className="h-6 w-24 rounded bg-zinc-200 dark:bg-zinc-800" />
                <div className="mt-2 h-4 w-80 max-w-full rounded bg-zinc-100 dark:bg-zinc-900" />
            </div>
            <div className="flex gap-3 border-b border-zinc-200 px-1 py-4 dark:border-zinc-800">
                <div className="h-11 w-11 rounded-full bg-zinc-100 dark:bg-zinc-900" />
                <div className="mt-1 h-5 flex-1 rounded bg-zinc-100 dark:bg-zinc-900" />
            </div>
            {Array.from({ length: 2 }).map((_, index) => (
                <div key={index} className="flex gap-3 border-b border-zinc-200 px-1 py-5 dark:border-zinc-800">
                    <div className="h-11 w-11 rounded-full bg-zinc-100 dark:bg-zinc-900" />
                    <div className="min-w-0 flex-1 space-y-3">
                        <div className="h-4 w-1/3 rounded bg-zinc-200 dark:bg-zinc-800" />
                        <div className="h-14 rounded bg-zinc-100 dark:bg-zinc-900" />
                        <div className="h-4 w-28 rounded bg-zinc-100 dark:bg-zinc-900" />
                    </div>
                </div>
            ))}
        </main>
        <aside className="hidden min-w-0 animate-pulse border-l border-zinc-200 pl-7 pr-4 dark:border-zinc-800 xl:block">
            <div className="h-4 w-24 rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="mt-4 grid grid-cols-3 gap-3">
                <div className="h-16 rounded bg-zinc-100 dark:bg-zinc-900" />
                <div className="h-16 rounded bg-zinc-100 dark:bg-zinc-900" />
                <div className="h-16 rounded bg-zinc-100 dark:bg-zinc-900" />
            </div>
            <div className="mt-6 h-24 rounded bg-zinc-100 dark:bg-zinc-900" />
            <div className="mt-6 h-32 rounded bg-zinc-100 dark:bg-zinc-900" />
        </aside>
    </div>
);

export { DashboardTab };

export const DocTab = dynamic(
    () => import("@/components/projects/tabs/DocTab"),
    { loading: () => <SkeletonDoc />, ssr: false }
);

export const UpdatesTab = dynamic(
    () => import("@/components/projects/tabs/UpdatesTab"),
    { loading: () => <SkeletonUpdates />, ssr: false }
);

export const TasksTab = dynamic(
    () => import("@/components/projects/v2/TasksTab"),
    { loading: () => <SkeletonTasks />, ssr: false }
);

export const FilesTab = dynamic(
    () => import("@/components/projects/v2/files-tab/FilesTabRoot").then((mod) => mod.FilesTabRoot),
    { loading: () => <SkeletonFiles />, ssr: false }
);

export const AnalyticsTab = dynamic(
    () => import("@/components/projects/tabs/AnalyticsTab"),
    { loading: () => <SkeletonAnalytics />, ssr: false }
);

export const SprintPlanning = dynamic(
    () => import("@/components/projects/tabs/SprintPlanning"),
    { loading: () => <SkeletonSprints />, ssr: true }
);

export const ProjectSettingsTab = dynamic(
    () => import("@/components/projects/tabs/ProjectSettingsTab"),
    { loading: () => <SkeletonSettings />, ssr: false }
);

export const ProjectPrivacyTermsTab = dynamic(
    () => import("@/components/projects/tabs/ProjectPrivacyTermsTab"),
    {
        loading: () => (
            <div className="mx-auto w-full max-w-5xl animate-pulse space-y-5 px-4 py-8">
                <div className="h-8 w-56 rounded bg-zinc-200 dark:bg-zinc-800" />
                <div className="h-28 rounded-3xl bg-zinc-100 dark:bg-zinc-900" />
                <div className="grid gap-4 md:grid-cols-2">
                    <div className="h-52 rounded-3xl bg-zinc-100 dark:bg-zinc-900" />
                    <div className="h-52 rounded-3xl bg-zinc-100 dark:bg-zinc-900" />
                </div>
            </div>
        ),
        ssr: false,
    },
);
