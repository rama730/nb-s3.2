'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toggleProjectFollowAction } from '@/app/actions/project';
import { queryKeys } from '@/lib/query-keys';

interface ToggleFollowParams {
    projectId: string;
    currentStatus: boolean;
    userId: string;
}



export function useToggleProjectFollow() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (params: ToggleFollowParams) => {
            const result = await toggleProjectFollowAction(params.projectId, !params.currentStatus);
            if (!result.success) throw new Error(result.error);
            return result;
        },
        onSuccess: (_, { userId }) => {
            queryClient.invalidateQueries({ queryKey: queryKeys.hub.userFollowedProjects(userId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.hub.projectsSimpleRoot() });
        },
    });
}
