import re

with open("src/components/profile/v2/ProfileV2Client.tsx", "r") as f:
    content = f.read()

# For handleConnectPrimary
old_primary = """    const handleConnectPrimary = async () => {
        if (!viewerUser || !profile) return;
        setIsLoading(true);
        try {
            if (status === 'none' || status === 'rejected') {
                await toast.promise(sendRequest.mutateAsync({ userId: profile.id }), {
                    loading: 'Sending request...',
                    success: 'Connection request sent',
                    error: 'Failed to send request'
                });
                setStatus('pending_outgoing');
                await refreshViewerOverlay();
            } else if (status === 'pending_incoming') {
                const connectionId = await resolveConnectionId();
                await toast.promise(acceptRequest.mutateAsync(connectionId), {
                    loading: 'Accepting request...',
                    success: 'Connection accepted',
                    error: 'Failed to accept request'
                });
                setStatus('accepted');
                await refreshViewerOverlay();
            }
        } catch (e) {
            logger.error('[ProfileV2Client] primary connection action failed', {"""

new_primary = """    const handleConnectPrimary = async () => {
        if (!viewerUser || !profile) return;
        const prevStatus = status;
        setIsLoading(true);
        try {
            if (status === 'none' || status === 'rejected') {
                setStatus('pending_outgoing');
                await toast.promise(sendRequest.mutateAsync({ userId: profile.id }), {
                    loading: 'Sending request...',
                    success: 'Connection request sent',
                    error: 'Failed to send request'
                });
                await refreshViewerOverlay();
            } else if (status === 'pending_incoming') {
                setStatus('accepted');
                const connectionId = await resolveConnectionId();
                await toast.promise(acceptRequest.mutateAsync(connectionId), {
                    loading: 'Accepting request...',
                    success: 'Connection accepted',
                    error: 'Failed to accept request'
                });
                await refreshViewerOverlay();
            }
        } catch (e) {
            setStatus(prevStatus);
            logger.error('[ProfileV2Client] primary connection action failed', {"""

content = content.replace(old_primary, new_primary)

# For handleConnectSecondary
old_secondary = """    const handleConnectSecondary = async () => {
        if (!viewerUser || !profile) return;
        setIsLoading(true);
        try {
            if (status === 'pending_outgoing') {
                const connectionId = await resolveConnectionId();
                await toast.promise(cancelRequest.mutateAsync(connectionId), {
                    loading: 'Cancelling request...',
                    success: 'Request cancelled',
                    error: 'Failed to cancel request'
                });
                setStatus('none');
                await refreshViewerOverlay();
            } else if (status === 'pending_incoming') {
                const connectionId = await resolveConnectionId();
                await toast.promise(rejectRequest.mutateAsync({ id: connectionId }), {
                    loading: 'Declining request...',
                    success: 'Request declined',
                    error: 'Failed to decline request'
                });
                setStatus('none');
                await refreshViewerOverlay();
            } else if (status === 'accepted') {
                const connectionId = await resolveConnectionId();
                await toast.promise(disconnect.mutateAsync(connectionId), {
                    loading: 'Disconnecting...',
                    success: 'Disconnected',
                    error: 'Failed to disconnect'
                });
                setStatus('none');
                await refreshViewerOverlay();
            }
        } catch (e) {
            logger.error('[ProfileV2Client] secondary connection action failed', {"""

new_secondary = """    const handleConnectSecondary = async () => {
        if (!viewerUser || !profile) return;
        const prevStatus = status;
        setIsLoading(true);
        try {
            if (status === 'pending_outgoing') {
                setStatus('none');
                const connectionId = await resolveConnectionId();
                await toast.promise(cancelRequest.mutateAsync(connectionId), {
                    loading: 'Cancelling request...',
                    success: 'Request cancelled',
                    error: 'Failed to cancel request'
                });
                await refreshViewerOverlay();
            } else if (status === 'pending_incoming') {
                setStatus('none');
                const connectionId = await resolveConnectionId();
                await toast.promise(rejectRequest.mutateAsync({ id: connectionId }), {
                    loading: 'Declining request...',
                    success: 'Request declined',
                    error: 'Failed to decline request'
                });
                await refreshViewerOverlay();
            } else if (status === 'accepted') {
                setStatus('none');
                const connectionId = await resolveConnectionId();
                await toast.promise(disconnect.mutateAsync(connectionId), {
                    loading: 'Disconnecting...',
                    success: 'Disconnected',
                    error: 'Failed to disconnect'
                });
                await refreshViewerOverlay();
            }
        } catch (e) {
            setStatus(prevStatus);
            logger.error('[ProfileV2Client] secondary connection action failed', {"""

content = content.replace(old_secondary, new_secondary)

with open("src/components/profile/v2/ProfileV2Client.tsx", "w") as f:
    f.write(content)

