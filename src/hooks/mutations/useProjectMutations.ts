'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toggleProjectBookmarkAction, toggleProjectFollowAction } from '@/app/actions/project';

interface ToggleBookmarkParams {
    projectId: string;
    currentStatus: boolean;
    userId: string;
}

interface ToggleFollowParams {
    projectId: string;
    currentStatus: boolean;
    userId: string;
}

export function useToggleProjectBookmark() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ projectId, currentStatus, userId }: ToggleBookmarkParams) => {
            const result = await toggleProjectBookmarkAction(projectId, !currentStatus);
            if (!result.success) throw new Error(result.error);
            return result;
        },
        onSuccess: (_, { userId }) => {
            queryClient.invalidateQueries({ queryKey: ['user-bookmarks', userId] });
        },
    });
}

export function useToggleProjectFollow() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ projectId, currentStatus, userId }: ToggleFollowParams) => {
            const result = await toggleProjectFollowAction(projectId, !currentStatus);
            if (!result.success) throw new Error(result.error);
            return result;
        },
        onSuccess: (_, { projectId, userId }) => {
            queryClient.invalidateQueries({ queryKey: ['user-followed-projects', userId] });
            queryClient.invalidateQueries({ queryKey: ['hub-projects'] });
        },
    });
}
