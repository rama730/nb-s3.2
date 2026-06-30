import re

with open("src/hooks/useConnections.ts", "r") as f:
    content = f.read()

old_event = """        const handleRealtimeEvent = (payload: any) => {
            // Toast notifications
            if (payload.eventType === 'INSERT' && payload.new?.addressee_id === userId && payload.new?.status === 'pending') {
                import('sonner').then(({ toast }) => {
                    toast('New connection request', { description: 'Check your pending requests.' });
                });
            } else if (payload.eventType === 'UPDATE' && payload.new?.status === 'accepted' && payload.new?.requester_id === userId) {
                import('sonner').then(({ toast }) => {
                    toast.success('Connection request accepted!');
                });
            }"""

new_event = """        const handleRealtimeEvent = (payload: ConnectionsRealtimePayload) => {
            // Toast notifications
            if (payload.eventType === 'INSERT' && payload.new?.addressee_id === userId && payload.new?.status === 'pending') {
                toast('New connection request', { description: 'Check your pending requests.' });
            } else if (payload.eventType === 'UPDATE' && payload.new?.status === 'accepted' && payload.new?.requester_id === userId) {
                toast.success('Connection request accepted!');
            }"""

content = content.replace(old_event, new_event)

with open("src/hooks/useConnections.ts", "w") as f:
    f.write(content)

