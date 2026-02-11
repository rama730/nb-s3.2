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
        mutationFn: async (params: ToggleBookmarkParams) => {
            const result = await toggleProjectBookmarkAction(params.projectId, !params.currentStatus);
            if (!result.success) throw new Error(result.error);
            return result;
        },
        onSuccess: (_, { userId }) => {
            queryClient.invalidateQueries({ queryKey: ['user-bookmarks', userId] });
            queryClient.invalidateQueries({ queryKey: ['hub-projects-simple'] });
            queryClient.invalidateQueries({ queryKey: ['hub-projects'] });
            queryClient.invalidateQueries({ queryKey: ['hub-trending'] });
        },
    });
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
            queryClient.invalidateQueries({ queryKey: ['user-followed-projects', userId] });
            queryClient.invalidateQueries({ queryKey: ['hub-projects-simple'] });
            queryClient.invalidateQueries({ queryKey: ['hub-projects'] });
            queryClient.invalidateQueries({ queryKey: ['hub-trending'] });
        },
    });
}
