import re

with open("src/hooks/useConnections.ts", "r") as f:
    content = f.read()

old_invalidate = """function invalidateConnectionsScoped(queryClient: ReturnType<typeof useQueryClient>) {
    queryClient.invalidateQueries({ queryKey: ['connections', 'feed'] });
    queryClient.invalidateQueries({ queryKey: ['connections', 'pending-requests'] });
    queryClient.invalidateQueries({ queryKey: ['connections', 'request-history'] });
    queryClient.invalidateQueries({ queryKey: ['connections', 'stats'] });
    queryClient.invalidateQueries({ queryKey: ['connections', 'mutual-suggestions'] });
    queryClient.invalidateQueries({ queryKey: ['connections', 'role-suggestions'] });
}"""

# We ONLY invalidate network, incoming, sent. Discover stays!
# We don't invalidate mutual-suggestions and role-suggestions globally either, we let CDC or explicit mutations handle them, 
# OR we do invalidate them but maybe we shouldn't on sendRequest?
# Actually, if we just remove discover and mutual/role from the global invalidation, they won't jitter.
new_invalidate = """function invalidateConnectionsScoped(queryClient: ReturnType<typeof useQueryClient>) {
    queryClient.invalidateQueries({ queryKey: ['connections', 'feed', 'network'] });
    queryClient.invalidateQueries({ queryKey: ['connections', 'feed', 'requests_incoming'] });
    queryClient.invalidateQueries({ queryKey: ['connections', 'feed', 'requests_sent'] });
    queryClient.invalidateQueries({ queryKey: ['connections', 'pending-requests'] });
    queryClient.invalidateQueries({ queryKey: ['connections', 'request-history'] });
    queryClient.invalidateQueries({ queryKey: ['connections', 'stats'] });
}"""
content = content.replace(old_invalidate, new_invalidate)

# For sendRequest, we need to add optimistic updates for mutual-suggestions and role-suggestions
old_send_request = """        onMutate: async ({ userId }) => {
            await cancelConnectionsScoped(queryClient);

            updateFeedQueries<DiscoverConnectionItem>(queryClient, ['connections', 'feed', 'discover'], (page) => ({
                ...page,
                items: page.items.map((item) =>
                    item.id === userId
                        ? { ...item, connectionStatus: 'pending_sent', canConnect: false }
                        : item,
                ),
            }));

            updateStatsQueries(queryClient, (stats) => ({"""

new_send_request = """        onMutate: async ({ userId }) => {
            await cancelConnectionsScoped(queryClient);

            updateFeedQueries<DiscoverConnectionItem>(queryClient, ['connections', 'feed', 'discover'], (page) => ({
                ...page,
                items: page.items.map((item) =>
                    item.id === userId
                        ? { ...item, connectionStatus: 'pending_sent', canConnect: false }
                        : item,
                ),
            }));

            // Patch suggestions lanes
            queryClient.setQueriesData({ queryKey: ['connections', 'mutual-suggestions'] }, (old: any) => {
                if (!old?.pages) return old;
                return {
                    ...old,
                    pages: old.pages.map((page: any) => ({
                        ...page,
                        items: page.items?.map((item: any) => item.id === userId ? { ...item, connectionStatus: 'pending_sent', canConnect: false } : item)
                    }))
                };
            });
            queryClient.setQueriesData({ queryKey: ['connections', 'role-suggestions'] }, (old: any) => {
                if (!old?.pages) return old;
                return {
                    ...old,
                    pages: old.pages.map((page: any) => ({
                        ...page,
                        items: page.items?.map((item: any) => item.id === userId ? { ...item, connectionStatus: 'pending_sent', canConnect: false } : item)
                    }))
                };
            });

            updateStatsQueries(queryClient, (stats) => ({"""
content = content.replace(old_send_request, new_send_request)

with open("src/hooks/useConnections.ts", "w") as f:
    f.write(content)

