import re

with open("src/hooks/useConnections.ts", "r") as f:
    content = f.read()

# Add withdrawAllSent to useMemo array
old_memo = """    }), [
        sendRequest,
        cancelRequest,
        acceptRequest,
        rejectRequest,
        dismissSuggestion,
        optimisticallyDismissSuggestion,
        restoreDismissedSuggestion,
        undoDismiss,
        undoRejectRequest,
        acceptAllIncoming,
        rejectAllIncoming,
        disconnect,
        updateTags,
        blockProfile
    ]);"""

new_memo = """    }), [
        sendRequest,
        cancelRequest,
        acceptRequest,
        rejectRequest,
        dismissSuggestion,
        optimisticallyDismissSuggestion,
        restoreDismissedSuggestion,
        undoDismiss,
        undoRejectRequest,
        acceptAllIncoming,
        rejectAllIncoming,
        withdrawAllSent,
        disconnect,
        updateTags,
        blockProfile
    ]);"""

content = content.replace(old_memo, new_memo)

with open("src/hooks/useConnections.ts", "w") as f:
    f.write(content)

