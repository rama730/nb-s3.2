import re

with open("src/hooks/useConnections.ts", "r") as f:
    content = f.read()

old_accept = """    const acceptRequest = useMutation({
        mutationFn: async (id: string) => {
            const result = await acceptConnectionRequest(id);
            if (!result.success) throw new Error(result.error || 'Failed to accept request');
            return { id };
        },
        onMutate: async (id) => {
            await cancelConnectionsScoped(queryClient);
            updatePendingRequestQueries(queryClient, (prev) => ({
                ...prev,
                incoming: prev.incoming.filter((item) => item.id !== id),
            }));

            updateStatsQueries(queryClient, (stats) => ({
                ...stats,
                totalConnections: stats.totalConnections + 1,
                pendingIncoming: Math.max(0, stats.pendingIncoming - 1),
            }));
        },"""

new_accept = """    const acceptRequest = useMutation({
        mutationFn: async (id: string) => {
            const result = await acceptConnectionRequest(id);
            if (!result.success) throw new Error(result.error || 'Failed to accept request');
            return { id };
        },
        onMutate: async (id) => {
            await cancelConnectionsScoped(queryClient);
            
            // Find the pending request to get user details for network insert
            let acceptedUser: any = null;
            updatePendingRequestQueries(queryClient, (prev) => {
                const req = prev.incoming.find(r => r.id === id);
                if (req) {
                    acceptedUser = {
                        id: id, // connection id
                        status: 'accepted',
                        createdAt: req.createdAt,
                        updatedAt: new Date().toISOString(),
                        user: {
                            id: req.requesterId,
                            username: req.requesterUsername,
                            fullName: req.requesterFullName,
                            avatarUrl: req.requesterAvatarUrl,
                            headline: req.requesterHeadline,
                            location: req.requesterLocation,
                        }
                    };
                }
                return {
                    ...prev,
                    incoming: prev.incoming.filter((item) => item.id !== id),
                };
            });

            if (acceptedUser) {
                updateFeedQueries(queryClient, ['connections', 'feed', 'network'], (page: any) => ({
                    ...page,
                    items: [acceptedUser, ...page.items]
                }));
            }

            updateStatsQueries(queryClient, (stats) => ({
                ...stats,
                totalConnections: stats.totalConnections + 1,
                pendingIncoming: Math.max(0, stats.pendingIncoming - 1),
            }));
        },"""

content = content.replace(old_accept, new_accept)

with open("src/hooks/useConnections.ts", "w") as f:
    f.write(content)

