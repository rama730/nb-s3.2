"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import { getProjectMembersAction } from "@/app/actions/project";
import { queryKeys } from "@/lib/query-keys";

export const PROJECT_MEMBERS_QUERY_KEY = (projectId: string) =>
    queryKeys.project.detail.members(projectId);

export function useProjectMembers(
    projectId: string,
    initialMembers: any[] = [],
    options?: {
        enabled?: boolean;
        initialHasMore?: boolean;
        initialCursor?: string | null;
        pageSize?: number;
    }
) {
    const pageSize = options?.pageSize ?? 20;
    const enabled = options?.enabled ?? true;

    const initialHasMore = options?.initialHasMore ?? initialMembers.length >= pageSize;
    const initialCursor = options?.initialCursor ?? undefined;

    const initialData = initialMembers.length
        ? {
            pages: [
                {
                    success: true,
                members: initialMembers,
                hasMore: initialHasMore,
                    nextCursor: initialCursor ?? undefined,
                },
            ],
            pageParams: [undefined],
        }
        : undefined;

    return useInfiniteQuery({
        queryKey: PROJECT_MEMBERS_QUERY_KEY(projectId),
        queryFn: async ({ pageParam }) => {
            const result = await getProjectMembersAction(projectId, pageSize, pageParam as string | undefined);
            if (!result.success) throw new Error(result.error);
            return {
                success: true as const,
                members: result.members ?? [],
                hasMore: result.hasMore ?? false,
                nextCursor: result.nextCursor ?? undefined,
            };
        },
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
        initialData,
        enabled,
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
    });
}
