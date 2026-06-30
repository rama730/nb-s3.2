import re

with open("src/hooks/useConnections.ts", "r") as f:
    content = f.read()

# 1. Update useConnectionsFeed to include tagFilter
content = content.replace(
    "        historyFilters?: HistoryFilters;\n        requestSortBy?: 'recent' | 'mutual' | 'oldest';\n    },",
    "        historyFilters?: HistoryFilters;\n        requestSortBy?: 'recent' | 'mutual' | 'oldest';\n        tagFilter?: string;\n    },"
)
content = content.replace(
    "    const requestSortBy = options?.requestSortBy;",
    "    const requestSortBy = options?.requestSortBy;\n    const tagFilter = options?.tagFilter;"
)
content = content.replace(
    "    const requestSortKey = requestSortBy || '';",
    "    const requestSortKey = requestSortBy || '';\n    const tagFilterKey = tagFilter || '';"
)
content = content.replace(
    "        queryKey: [...CONNECTIONS_QUERY_KEYS.feed(tab, limit, search), sortBy || 'recent', filtersKey, requestSortKey] as const,",
    "        queryKey: [...CONNECTIONS_QUERY_KEYS.feed(tab, limit, search), sortBy || 'recent', filtersKey, requestSortKey, tagFilterKey] as const,"
)
content = content.replace(
    "                requestSortBy,\n            } satisfies ConnectionsFeedInput);",
    "                requestSortBy,\n                tagFilter,\n            } satisfies ConnectionsFeedInput);"
)

content = content.replace(
    "export function useConnections(limit = 50, search?: string, sortBy?: 'recent' | 'name' | 'oldest') {\n    return useConnectionsFeed('network', { limit, search, sortBy });\n}",
    "export function useConnections(limit = 50, search?: string, sortBy?: 'recent' | 'name' | 'oldest', tagFilter?: string) {\n    return useConnectionsFeed('network', { limit, search, sortBy, tagFilter });\n}"
)

# 2. Add useConnectionTags and bulk action hooks
hooks = """
import { getConnectionTags, bulkDisconnectConnections, bulkUpdateConnectionTags } from '@/app/actions/connections';

export function useConnectionTags() {
    return useQuery({
        queryKey: ['connections', 'tags'],
        queryFn: async () => {
            const res = await getConnectionTags();
            if (!res.success) throw new Error(res.error || 'Failed to fetch tags');
            return res.tags;
        }
    });
}

export function useBulkConnectionsActions() {
    const queryClient = useQueryClient();

    const disconnect = useMutation({
        mutationFn: async (ids: string[]) => {
            const res = await bulkDisconnectConnections(ids);
            if (!res.success) throw new Error(res.error);
            return res;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['connections', 'feed'] });
            queryClient.invalidateQueries({ queryKey: ['connections', 'stats'] });
        }
    });

    const updateTags = useMutation({
        mutationFn: async ({ ids, tags }: { ids: string[], tags: string[] }) => {
            const res = await bulkUpdateConnectionTags(ids, tags);
            if (!res.success) throw new Error(res.error);
            return res;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['connections', 'feed'] });
            queryClient.invalidateQueries({ queryKey: ['connections', 'tags'] });
        }
    });

    return { disconnect, updateTags };
}
"""

content = content + hooks

with open("src/hooks/useConnections.ts", "w") as f:
    f.write(content)

print("Added network hooks!")
