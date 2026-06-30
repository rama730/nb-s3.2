import re

with open("src/hooks/useConnections.ts", "r") as f:
    content = f.read()

old_accept_all = """    const acceptAllIncoming = useMutation({
        mutationFn: async (limit: number | undefined) => {
            const result = await acceptAllIncomingConnectionRequests(limit);
            if (!result.success) throw new Error(result.error || 'Failed to accept all requests');
            return result;
        },
        onMutate: async () => {
            await cancelConnectionsScoped(queryClient);
            let acceptedCount = 0;

            updatePendingRequestQueries(queryClient, (prev) => {
                acceptedCount = Math.max(acceptedCount, prev.incoming.length);
                return {
                    ...prev,
                    incoming: [],
                };
            });

            if (acceptedCount > 0) {
                updateStatsQueries(queryClient, (stats) => ({
                    ...stats,
                    totalConnections: stats.totalConnections + acceptedCount,
                    pendingIncoming: Math.max(0, stats.pendingIncoming - acceptedCount),
                }));
            }
        },
        onSettled: invalidateAll,
    });"""

new_accept_all = """    const acceptAllIncoming = useMutation({
        mutationFn: async (limit: number | undefined) => {
            const result = await acceptAllIncomingConnectionRequests(limit);
            if (!result.success) throw new Error(result.error || 'Failed to accept all requests');
            return result;
        },
        onMutate: async () => {
            await cancelConnectionsScoped(queryClient);
            
            const previousPending = queryClient.getQueryData(['connections', 'pending-requests']);
            const previousStats = queryClient.getQueryData(['connections', 'stats']);
            
            let acceptedCount = 0;

            updatePendingRequestQueries(queryClient, (prev) => {
                acceptedCount = Math.max(acceptedCount, prev.incoming.length);
                return {
                    ...prev,
                    incoming: [],
                };
            });

            if (acceptedCount > 0) {
                updateStatsQueries(queryClient, (stats) => ({
                    ...stats,
                    totalConnections: stats.totalConnections + acceptedCount,
                    pendingIncoming: Math.max(0, stats.pendingIncoming - acceptedCount),
                }));
            }
            
            return { previousPending, previousStats };
        },
        onError: (_err, _vars, context) => {
            if (context?.previousPending) queryClient.setQueryData(['connections', 'pending-requests'], context.previousPending);
            if (context?.previousStats) queryClient.setQueryData(['connections', 'stats'], context.previousStats);
            invalidateAll();
        },
        onSettled: () => invalidateAll(),
    });"""

content = content.replace(old_accept_all, new_accept_all)

old_reject_all = """    const rejectAllIncoming = useMutation({
        mutationFn: async (limit: number | undefined) => {
            const result = await rejectAllIncomingConnectionRequests(limit);
            if (!result.success) throw new Error(result.error || 'Failed to reject all requests');
            return result;
        },
        onMutate: async () => {
            await cancelConnectionsScoped(queryClient);
            let rejectedCount = 0;

            updatePendingRequestQueries(queryClient, (prev) => {
                rejectedCount = Math.max(rejectedCount, prev.incoming.length);
                return {
                    ...prev,
                    incoming: [],
                };
            });

            if (rejectedCount > 0) {
                updateStatsQueries(queryClient, (stats) => ({
                    ...stats,
                    pendingIncoming: Math.max(0, stats.pendingIncoming - rejectedCount),
                }));
            }
        },
        onSettled: invalidateAll,
    });"""

new_reject_all = """    const rejectAllIncoming = useMutation({
        mutationFn: async (limit: number | undefined) => {
            const result = await rejectAllIncomingConnectionRequests(limit);
            if (!result.success) throw new Error(result.error || 'Failed to reject all requests');
            return result;
        },
        onMutate: async () => {
            await cancelConnectionsScoped(queryClient);
            
            const previousPending = queryClient.getQueryData(['connections', 'pending-requests']);
            const previousStats = queryClient.getQueryData(['connections', 'stats']);
            
            let rejectedCount = 0;

            updatePendingRequestQueries(queryClient, (prev) => {
                rejectedCount = Math.max(rejectedCount, prev.incoming.length);
                return {
                    ...prev,
                    incoming: [],
                };
            });

            if (rejectedCount > 0) {
                updateStatsQueries(queryClient, (stats) => ({
                    ...stats,
                    pendingIncoming: Math.max(0, stats.pendingIncoming - rejectedCount),
                }));
            }
            
            return { previousPending, previousStats };
        },
        onError: (_err, _vars, context) => {
            if (context?.previousPending) queryClient.setQueryData(['connections', 'pending-requests'], context.previousPending);
            if (context?.previousStats) queryClient.setQueryData(['connections', 'stats'], context.previousStats);
            invalidateAll();
        },
        onSettled: () => invalidateAll(),
    });"""

content = content.replace(old_reject_all, new_reject_all)

with open("src/hooks/useConnections.ts", "w") as f:
    f.write(content)

