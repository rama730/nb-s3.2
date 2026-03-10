'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import {
    getWorkspaceOverviewConversationsSection,
    getWorkspaceOverviewFilesSection,
    getWorkspaceOverviewMentionsSection,
    getWorkspaceOverviewProjectsSection,
    getWorkspaceOverviewRecentActivitySection,
    getWorkspaceOverviewTasksSection,
    type RecentActivityItem,
    type WorkspaceMentionsRequestItem,
    type WorkspaceProject,
    type WorkspaceRecentFile,
    type WorkspaceTask,
} from '@/app/actions/workspace';
import type { ConversationWithDetails } from '@/app/actions/messaging';
import { queryKeys } from '@/lib/query-keys';
import { WIDGET_REGISTRY, getRequiredOverviewSections } from '@/components/workspace/dashboard/widgetRegistry';
import type { WidgetId, WorkspaceOverviewSectionKey } from '@/components/workspace/dashboard/types';

interface UseWorkspaceOverviewSectionsOptions {
    widgetIds: string[];
    enabled?: boolean;
    initialData?: {
        tasks?: WorkspaceTask[];
        projects?: WorkspaceProject[];
        conversations?: ConversationWithDetails[];
        recentActivity?: RecentActivityItem[];
        files?: WorkspaceRecentFile[];
        mentionsRequests?: WorkspaceMentionsRequestItem[];
    } | null;
}

export function useWorkspaceOverviewSections({
    widgetIds,
    enabled = true,
    initialData = null,
}: UseWorkspaceOverviewSectionsOptions) {
    const requiredSections = useMemo(() => getRequiredOverviewSections(widgetIds), [widgetIds]);

    const staleTimes = useMemo(() => {
        const defaults: Record<WorkspaceOverviewSectionKey, number> = {
            tasks: 30_000,
            projects: 30_000,
            conversations: 20_000,
            recentActivity: 30_000,
            files: 30_000,
            mentionsRequests: 20_000,
        };

        for (const widgetId of widgetIds) {
            const config = WIDGET_REGISTRY[widgetId as WidgetId];
            if (!config) continue;
            const refreshMs = config.capability.refreshMs;
            if (!refreshMs) continue;
            for (const section of config.capability.sections) {
                defaults[section] = Math.min(defaults[section], refreshMs);
            }
        }

        return defaults;
    }, [widgetIds]);

    const needsTasks = requiredSections.has('tasks');
    const needsProjects = requiredSections.has('projects');
    const needsConversations = requiredSections.has('conversations');
    const needsActivity = requiredSections.has('recentActivity');
    const needsFiles = requiredSections.has('files');
    const needsMentionsRequests = requiredSections.has('mentionsRequests');

    const [tasksQuery, projectsQuery, conversationsQuery, activityQuery, filesQuery, mentionsRequestsQuery] = useQueries({
        queries: [
            {
                queryKey: queryKeys.workspace.overviewSection.tasks(),
                queryFn: async () => {
                    const result = await getWorkspaceOverviewTasksSection();
                    return result.success ? (result.tasks ?? []) : [];
                },
                staleTime: staleTimes.tasks,
                enabled: enabled && needsTasks,
                initialData: initialData?.tasks ?? [],
            },
            {
                queryKey: queryKeys.workspace.overviewSection.projects(),
                queryFn: async () => {
                    const result = await getWorkspaceOverviewProjectsSection();
                    return result.success ? (result.projects ?? []) : [];
                },
                staleTime: staleTimes.projects,
                enabled: enabled && needsProjects,
                initialData: initialData?.projects ?? [],
            },
            {
                queryKey: queryKeys.workspace.overviewSection.conversations(),
                queryFn: async () => {
                    const result = await getWorkspaceOverviewConversationsSection();
                    return result.success ? (result.conversations ?? []) : [];
                },
                staleTime: staleTimes.conversations,
                enabled: enabled && needsConversations,
                initialData: initialData?.conversations ?? [],
            },
            {
                queryKey: queryKeys.workspace.overviewSection.recentActivity(),
                queryFn: async () => {
                    const result = await getWorkspaceOverviewRecentActivitySection();
                    return result.success ? (result.recentActivity ?? []) : [];
                },
                staleTime: staleTimes.recentActivity,
                enabled: enabled && needsActivity,
                initialData: initialData?.recentActivity ?? [],
            },
            {
                queryKey: queryKeys.workspace.overviewSection.files(),
                queryFn: async () => {
                    const result = await getWorkspaceOverviewFilesSection();
                    return result.success ? (result.files ?? []) : [];
                },
                staleTime: staleTimes.files,
                enabled: enabled && needsFiles,
                initialData: initialData?.files ?? [],
            },
            {
                queryKey: queryKeys.workspace.overviewSection.mentionsRequests(),
                queryFn: async () => {
                    const result = await getWorkspaceOverviewMentionsSection();
                    return result.success ? (result.mentionsRequests ?? []) : [];
                },
                staleTime: staleTimes.mentionsRequests,
                enabled: enabled && needsMentionsRequests,
                initialData: initialData?.mentionsRequests ?? [],
            },
        ],
    });

    return useMemo(() => ({
        tasks: tasksQuery.data ?? [],
        projects: projectsQuery.data ?? [],
        conversations: conversationsQuery.data ?? [],
        recentActivity: activityQuery.data ?? [],
        files: filesQuery.data ?? [],
        mentionsRequests: mentionsRequestsQuery.data ?? [],
        isLoading:
            tasksQuery.isLoading ||
            projectsQuery.isLoading ||
            conversationsQuery.isLoading ||
            activityQuery.isLoading ||
            filesQuery.isLoading ||
            mentionsRequestsQuery.isLoading,
    }), [
        tasksQuery.data,
        projectsQuery.data,
        conversationsQuery.data,
        activityQuery.data,
        filesQuery.data,
        mentionsRequestsQuery.data,
        tasksQuery.isLoading,
        projectsQuery.isLoading,
        conversationsQuery.isLoading,
        activityQuery.isLoading,
        filesQuery.isLoading,
        mentionsRequestsQuery.isLoading,
    ]);
}
