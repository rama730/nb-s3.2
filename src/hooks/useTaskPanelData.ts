'use client';

import { useQuery } from '@tanstack/react-query';
import { getProjectMembersAction } from '@/app/actions/project';
import { fetchProjectSprintsAction } from '@/app/actions/project';

/**
 * useTaskPanelData
 *
 * Lazily fetches members and sprints for a project when the task detail panel opens.
 * staleTime: 5 min — members/sprints rarely change, so we cache aggressively.
 * Only fires when projectId is non-null (panel is open).
 */
export function useTaskPanelData(projectId: string | null) {
    const { data: membersData } = useQuery({
        queryKey: ['workspace', 'panel-members', projectId],
        queryFn: () => getProjectMembersAction(projectId!, 50),
        enabled: !!projectId,
        staleTime: 5 * 60_000,
    });

    const { data: sprintsData } = useQuery({
        queryKey: ['workspace', 'panel-sprints', projectId],
        queryFn: () => fetchProjectSprintsAction(projectId!),
        enabled: !!projectId,
        staleTime: 5 * 60_000,
    });

    return {
        members: membersData?.members ?? [],
        sprints: sprintsData?.sprints ?? [],
    };
}
