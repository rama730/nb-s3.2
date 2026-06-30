import re

with open("src/hooks/useConnections.ts", "r") as f:
    content = f.read()

# 1. Update patchConnectionsRealtimeCaches to handle isDelete
content = content.replace(
    "const otherUserId =",
    "const isDelete = !pair.current && !!pair.previous;\n    const otherUserId ="
)

content = content.replace(
    "if (row.status !== 'accepted') return null;",
    "if (isDelete || row.status !== 'accepted') return null;"
)

content = content.replace(
    "if (row.status !== 'pending') return null;",
    "if (isDelete || row.status !== 'pending') return null;"
)

content = content.replace(
    "const nextStatus = resolveDiscoverStatus(row, userId);",
    "const nextStatus = isDelete ? 'none' : resolveDiscoverStatus(row, userId);"
)

# 2. Update handleRealtimeEvent to call patch functions
old_handle_realtime = """        const handleRealtimeEvent = (payload: any) => {
            // Toast notifications
            if (payload.eventType === 'INSERT' && payload.new?.addressee_id === userId && payload.new?.status === 'pending') {
                import('sonner').then(({ toast }) => {
                    toast('New connection request', { description: 'Check your pending requests.' });
                });
            } else if (payload.eventType === 'UPDATE' && payload.new?.status === 'accepted' && payload.new?.requester_id === userId) {
                import('sonner').then(({ toast }) => {
                    toast.success('Connection request accepted!');
                });
            }

            if (invalidateTimerRef.current) {
                clearTimeout(invalidateTimerRef.current);
            }
            
            invalidateTimerRef.current = setTimeout(() => {
                invalidateTimerRef.current = null;
                invalidateConnectionsScoped(queryClient);
            }, 250);
        };"""

new_handle_realtime = """        const handleRealtimeEvent = (payload: any) => {
            // Toast notifications
            if (payload.eventType === 'INSERT' && payload.new?.addressee_id === userId && payload.new?.status === 'pending') {
                import('sonner').then(({ toast }) => {
                    toast('New connection request', { description: 'Check your pending requests.' });
                });
            } else if (payload.eventType === 'UPDATE' && payload.new?.status === 'accepted' && payload.new?.requester_id === userId) {
                import('sonner').then(({ toast }) => {
                    toast.success('Connection request accepted!');
                });
            }

            // Attempt instantaneous cache patch
            try {
                const statsPatched = patchRealtimeStatsFromPayload(queryClient, userId, payload);
                const cachesPatched = patchConnectionsRealtimeCaches(queryClient, userId, payload);

                // If patch logic successfully updated UI, we skip the heavy network refetch!
                if (statsPatched || cachesPatched.patched) {
                    return;
                }
            } catch (err) {
                console.error("Failed to patch realtime caches, falling back to refetch", err);
            }

            if (invalidateTimerRef.current) {
                clearTimeout(invalidateTimerRef.current);
            }
            
            invalidateTimerRef.current = setTimeout(() => {
                invalidateTimerRef.current = null;
                invalidateConnectionsScoped(queryClient);
            }, 250);
        };"""

content = content.replace(old_handle_realtime, new_handle_realtime)

# 3. Update invalidateAll in useConnectionMutations to accept targetId
old_invalidate_all = """    const invalidateAll = useCallback(() => {
        if (invalidateTimeoutRef.current) {
            clearTimeout(invalidateTimeoutRef.current);
        }
        invalidateTimeoutRef.current = setTimeout(() => {
            invalidateConnectionsScoped(queryClient);
            if (user?.id) {
                queryClient.invalidateQueries({ queryKey: queryKeys.profile.byTarget(user.id) });
            }
            invalidateTimeoutRef.current = null;
        }, 150);
    }, [queryClient, user?.id]);"""

new_invalidate_all = """    const invalidateAll = useCallback((targetId?: string) => {
        if (invalidateTimeoutRef.current) {
            clearTimeout(invalidateTimeoutRef.current);
        }
        invalidateTimeoutRef.current = setTimeout(() => {
            invalidateConnectionsScoped(queryClient);
            if (targetId) {
                queryClient.invalidateQueries({ queryKey: queryKeys.profile.byTarget(targetId) });
            }
            invalidateTimeoutRef.current = null;
        }, 150);
    }, [queryClient]);"""

content = content.replace(old_invalidate_all, new_invalidate_all)

# Also update the mutation onError/onSettled to pass targetId if available
content = re.sub(
    r"onError: invalidateAll,\n\s*onSettled: invalidateAll,",
    r"onError: () => invalidateAll(),\n        onSettled: () => invalidateAll(),",
    content
)

content = content.replace(
    "onError: () => invalidateAll(),\n        onSettled: () => invalidateAll(),",
    "onError: (_err, vars) => invalidateAll((vars as any)?.userId || (vars as any)?.id),\n        onSettled: (_data, _err, vars) => invalidateAll((vars as any)?.userId || (vars as any)?.id),"
)

# 4. Add mutual-suggestions and role-suggestions to invalidateConnectionsScoped
old_invalidate_scoped = """function invalidateConnectionsScoped(queryClient: ReturnType<typeof useQueryClient>) {
    queryClient.invalidateQueries({ queryKey: ['connections', 'feed'] });
    queryClient.invalidateQueries({ queryKey: ['connections', 'pending-requests'] });
    queryClient.invalidateQueries({ queryKey: ['connections', 'request-history'] });
    queryClient.invalidateQueries({ queryKey: ['connections', 'stats'] });
}"""

new_invalidate_scoped = """function invalidateConnectionsScoped(queryClient: ReturnType<typeof useQueryClient>) {
    queryClient.invalidateQueries({ queryKey: ['connections', 'feed'] });
    queryClient.invalidateQueries({ queryKey: ['connections', 'pending-requests'] });
    queryClient.invalidateQueries({ queryKey: ['connections', 'request-history'] });
    queryClient.invalidateQueries({ queryKey: ['connections', 'stats'] });
    queryClient.invalidateQueries({ queryKey: ['connections', 'mutual-suggestions'] });
    queryClient.invalidateQueries({ queryKey: ['connections', 'role-suggestions'] });
}"""
content = content.replace(old_invalidate_scoped, new_invalidate_scoped)

with open("src/hooks/useConnections.ts", "w") as f:
    f.write(content)

