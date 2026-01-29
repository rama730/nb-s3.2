import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import {
    getAcceptedConnections,
    getPendingRequests,
    getConnectionStats,
    sendConnectionRequest,
    cancelConnectionRequest,
    acceptConnectionRequest,
    rejectConnectionRequest,
    removeConnection
} from '@/app/actions/connections';
// Toast removed from hook for architectural purity

// ============================================================================
// DATA FETCHING HOOKS
// ============================================================================

export function useConnections(limit = 50, search?: string) {
    return useInfiniteQuery({
        queryKey: ['connections', 'list', search],
        queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
            const result = await getAcceptedConnections(limit, pageParam, search);
            return result;
        },
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
}

export function usePendingRequests() {
    return useQuery({
        queryKey: ['connections', 'requests'],
        queryFn: async () => {
            const result = await getPendingRequests();
            // Flatten structures for easier consumption if needed
            return result;
        },
        // Polling for new requests every minute
        refetchInterval: 1000 * 60,
    });
}

export function useConnectionStats() {
    return useQuery({
        queryKey: ['connections', 'stats'],
        queryFn: () => getConnectionStats(),
        staleTime: 1000 * 60 * 5,
    });
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

export function useConnectionMutations() {
    const queryClient = useQueryClient();

    const invalidateAll = () => {
        queryClient.invalidateQueries({ queryKey: ['connections'] });
        queryClient.invalidateQueries({ queryKey: ['profile'] }); // In case profile header status changes
    };

    const sendRequest = useMutation({
        mutationFn: async ({ userId, message }: { userId: string, message?: string }) => {
            const result = await sendConnectionRequest(userId, message);
            if (!result.success) throw new Error(result.error);
            return result;
        },
        onSuccess: () => {
            invalidateAll();
        },
        onError: (error) => console.error(error),
    });

    const cancelRequest = useMutation({
        mutationFn: async (id: string) => {
            const result = await cancelConnectionRequest(id);
            if (!result.success) throw new Error(result.error);
            return result;
        },
        onSuccess: () => {
            invalidateAll();
        },
        onError: (error) => console.error(error),
    });

    const acceptRequest = useMutation({
        mutationFn: async (id: string) => {
            const result = await acceptConnectionRequest(id);
            if (!result.success) throw new Error(result.error);
            return result;
        },
        onSuccess: () => {
            invalidateAll();
        },
        onError: (error) => console.error(error),
    });

    const rejectRequest = useMutation({
        mutationFn: async (id: string) => {
            const result = await rejectConnectionRequest(id);
            if (!result.success) throw new Error(result.error);
            return result;
        },
        onSuccess: () => {
            invalidateAll();
        },
        onError: (error) => console.error(error),
    });

    const disconnect = useMutation({
        mutationFn: async (id: string) => {
            const result = await removeConnection(id);
            if (!result.success) throw new Error(result.error);
            return result;
        },
        onSuccess: () => {
            invalidateAll();
        },
        onError: (error) => console.error(error),
    });

    return {
        sendRequest,
        cancelRequest,
        acceptRequest,
        rejectRequest,
        disconnect
    };
}
