"use client";

import { useQuery } from "@tanstack/react-query";

import {
    readProjectAnalyticsFilesAction,
    readProjectAnalyticsMembersAction,
    readProjectAnalyticsOverviewAction,
    readProjectAnalyticsReportAction,
    readProjectAnalyticsRisksAction,
    readProjectAnalyticsSprintsAction,
    readProjectAnalyticsSnapshotAction,
    readProjectAnalyticsTimelineAction,
    readProjectAnalyticsWorkflowAction,
    readProjectMemberAnalyticsAction,
} from "@/app/actions/project";
import { queryKeys } from "@/lib/query-keys";
import type { ProjectAnalyticsContextFilters, ProjectAnalyticsTimelineFilters } from "@/lib/projects/analytics";

export const PROJECT_ANALYTICS_QUERY_KEY = (projectId: string) =>
    queryKeys.project.detail.analytics(projectId);
export const PROJECT_ANALYTICS_OVERVIEW_QUERY_KEY = (projectId: string, context?: Partial<ProjectAnalyticsContextFilters> | null) =>
    queryKeys.project.detail.analyticsOverview(projectId, context as Record<string, unknown> | null | undefined);
export const PROJECT_ANALYTICS_MEMBERS_QUERY_KEY = (projectId: string, context?: Partial<ProjectAnalyticsContextFilters> | null) =>
    queryKeys.project.detail.analyticsMembers(projectId, context as Record<string, unknown> | null | undefined);
export const PROJECT_ANALYTICS_MEMBER_QUERY_KEY = (projectId: string, memberId: string | null | undefined) =>
    queryKeys.project.detail.analyticsMember(projectId, memberId);
export const PROJECT_ANALYTICS_WORKFLOW_QUERY_KEY = (projectId: string, context?: Partial<ProjectAnalyticsContextFilters> | null) =>
    queryKeys.project.detail.analyticsWorkflow(projectId, context as Record<string, unknown> | null | undefined);
export const PROJECT_ANALYTICS_SPRINTS_QUERY_KEY = (projectId: string, context?: Partial<ProjectAnalyticsContextFilters> | null) =>
    queryKeys.project.detail.analyticsSprints(projectId, context as Record<string, unknown> | null | undefined);
export const PROJECT_ANALYTICS_FILES_QUERY_KEY = (projectId: string, context?: Partial<ProjectAnalyticsContextFilters> | null) =>
    queryKeys.project.detail.analyticsFiles(projectId, context as Record<string, unknown> | null | undefined);
export const PROJECT_ANALYTICS_RISKS_QUERY_KEY = (projectId: string, context?: Partial<ProjectAnalyticsContextFilters> | null) =>
    queryKeys.project.detail.analyticsRisks(projectId, context as Record<string, unknown> | null | undefined);
export const PROJECT_ANALYTICS_SNAPSHOT_QUERY_KEY = (projectId: string, context?: Partial<ProjectAnalyticsContextFilters> | null) =>
    queryKeys.project.detail.analyticsSnapshot(projectId, context as Record<string, unknown> | null | undefined);
export const PROJECT_ANALYTICS_TIMELINE_QUERY_KEY = (projectId: string, filters: Record<string, unknown>) =>
    queryKeys.project.detail.analyticsTimeline(projectId, filters);

export function useProjectAnalytics(projectId: string) {
    return useProjectAnalyticsOverview(projectId);
}

export function useProjectAnalyticsOverview(projectId: string, context?: Partial<ProjectAnalyticsContextFilters> | null) {
    return useQuery({
        queryKey: PROJECT_ANALYTICS_OVERVIEW_QUERY_KEY(projectId, context),
        queryFn: async () => {
            const result = await readProjectAnalyticsOverviewAction(projectId, context);
            if (!result.success) throw new Error(result.error);
            return result.overview;
        },
        staleTime: 1000 * 60 * 10,
        refetchOnWindowFocus: false,
        gcTime: 1000 * 60 * 30,
    });
}

export function useProjectAnalyticsMembers(projectId: string, context?: Partial<ProjectAnalyticsContextFilters> | null, enabled = true) {
    return useQuery({
        queryKey: PROJECT_ANALYTICS_MEMBERS_QUERY_KEY(projectId, context),
        queryFn: async () => {
            const result = await readProjectAnalyticsMembersAction(projectId, context);
            if (!result.success) throw new Error(result.error);
            return result.members;
        },
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
        enabled,
    });
}

export function useProjectMemberAnalytics(projectId: string, memberId: string | null, enabled = true, context?: Partial<ProjectAnalyticsContextFilters> | null) {
    return useQuery({
        queryKey: [...PROJECT_ANALYTICS_MEMBER_QUERY_KEY(projectId, memberId), context ?? null] as const,
        queryFn: async () => {
            if (!memberId) throw new Error("Missing member id");
            const result = await readProjectMemberAnalyticsAction(projectId, memberId, context);
            if (!result.success) throw new Error(result.error);
            return result.detail;
        },
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
        enabled: enabled && Boolean(memberId),
    });
}

export function useProjectAnalyticsWorkflow(projectId: string, context?: Partial<ProjectAnalyticsContextFilters> | null) {
    return useQuery({
        queryKey: PROJECT_ANALYTICS_WORKFLOW_QUERY_KEY(projectId, context),
        queryFn: async () => {
            const result = await readProjectAnalyticsWorkflowAction(projectId, context);
            if (!result.success) throw new Error(result.error);
            return result.workflow;
        },
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
    });
}

export function useProjectAnalyticsSprints(projectId: string, context?: Partial<ProjectAnalyticsContextFilters> | null) {
    return useQuery({
        queryKey: PROJECT_ANALYTICS_SPRINTS_QUERY_KEY(projectId, context),
        queryFn: async () => {
            const result = await readProjectAnalyticsSprintsAction(projectId, context);
            if (!result.success) throw new Error(result.error);
            return result.sprints;
        },
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
    });
}

export function useProjectAnalyticsFiles(projectId: string, context?: Partial<ProjectAnalyticsContextFilters> | null) {
    return useQuery({
        queryKey: PROJECT_ANALYTICS_FILES_QUERY_KEY(projectId, context),
        queryFn: async () => {
            const result = await readProjectAnalyticsFilesAction(projectId, context);
            if (!result.success) throw new Error(result.error);
            return result.files;
        },
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
    });
}

export function useProjectAnalyticsRisks(projectId: string, context?: Partial<ProjectAnalyticsContextFilters> | null) {
    return useQuery({
        queryKey: PROJECT_ANALYTICS_RISKS_QUERY_KEY(projectId, context),
        queryFn: async () => {
            const result = await readProjectAnalyticsRisksAction(projectId, context);
            if (!result.success) throw new Error(result.error);
            return result.risks;
        },
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
    });
}

export function useProjectAnalyticsSnapshot(projectId: string, context?: Partial<ProjectAnalyticsContextFilters> | null) {
    return useQuery({
        queryKey: PROJECT_ANALYTICS_SNAPSHOT_QUERY_KEY(projectId, context),
        queryFn: async () => {
            const result = await readProjectAnalyticsSnapshotAction(projectId, context);
            if (!result.success) throw new Error(result.error);
            return result.snapshot;
        },
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
    });
}

export async function downloadProjectAnalyticsReport(projectId: string, context?: Partial<ProjectAnalyticsContextFilters> | null) {
    const result = await readProjectAnalyticsReportAction(projectId, context);
    if (!result.success) throw new Error(result.error);
    return { filename: result.filename, content: result.content };
}

export function useProjectAnalyticsTimeline(projectId: string, filters: ProjectAnalyticsTimelineFilters = {}) {
    return useQuery({
        queryKey: PROJECT_ANALYTICS_TIMELINE_QUERY_KEY(projectId, filters as Record<string, unknown>),
        queryFn: async () => {
            const result = await readProjectAnalyticsTimelineAction(projectId, filters);
            if (!result.success) throw new Error(result.error);
            return result.timeline;
        },
        staleTime: 1000 * 60 * 3,
        refetchOnWindowFocus: false,
    });
}
