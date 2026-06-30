import re

with open("src/hooks/useConnections.ts", "r") as f:
    content = f.read()

# We want to replace the whole `useConnectionsRealtimeInvalidation` function.
# Also we can remove `patchConnectionsRealtimeCaches`, `patchRealtimeStatsFromPayload`, etc if we want, but it's safer to just replace `useConnectionsRealtimeInvalidation` first.

pattern = r"export function useConnectionsRealtimeInvalidation\(\) \{[\s\S]*?(?=\nexport function useConnectionsFeed)"
replacement = """export function useGlobalConnectionsRealtime() {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const { subscribeUserNotifications } = useRealtime();
    const userId = user?.id;
    const invalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!userId) return;

        const handleRealtimeEvent = (payload: any) => {
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
        };

        const unsubscribe = subscribeUserNotifications((event) => {
            if (event.kind === 'connection') {
                handleRealtimeEvent(event.payload);
            }
        });

        return () => {
            if (invalidateTimerRef.current) {
                clearTimeout(invalidateTimerRef.current);
                invalidateTimerRef.current = null;
            }
            unsubscribe();
        };
    }, [queryClient, subscribeUserNotifications, userId]);
}
"""

new_content = re.sub(pattern, replacement, content)
with open("src/hooks/useConnections.ts", "w") as f:
    f.write(new_content)

print("Replaced!")
