'use client';

import { useQuery } from '@tanstack/react-query';
import { getProjectMembersAction } from '@/app/actions/project';
import { fetchProjectSprintsAction } from '@/app/actions/project';
import { queryKeys } from '@/lib/query-keys';

/**
 * useTaskPanelData
 *
 * Lazily fetches members and sprints for a project when the task detail panel opens.
 * staleTime: 5 min — members/sprints rarely change, so we cache aggressively.
 * Only fires when projectId is non-null (panel is open).
 */
export function useTaskPanelData(projectId: string | null) {
    const { data: membersData } = useQuery({
        queryKey: queryKeys.workspace.panelMembers(projectId),
        queryFn: () => getProjectMembersAction(projectId!, 50),
        enabled: !!projectId,
        staleTime: 5 * 60_000,
    });

    const { data: sprintsData } = useQuery({
        queryKey: queryKeys.workspace.panelSprints(projectId),
        queryFn: () => fetchProjectSprintsAction(projectId!),
        enabled: !!projectId,
        staleTime: 5 * 60_000,
    });

    return {
        members: membersData?.success ? membersData.members : [],
        sprints: sprintsData?.success ? sprintsData.sprints : [],
    };
}
