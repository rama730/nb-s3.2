import re

with open("src/components/people/RequestsTab.tsx", "r") as f:
    content = f.read()

# Add withdrawAllSent to useConnectionMutations destructuring
content = content.replace("acceptAllIncoming, rejectAllIncoming, blockProfile", "acceptAllIncoming, rejectAllIncoming, blockProfile, withdrawAllSent")

# Find Sent section header and add Withdraw All button
# The Sent section has a header like:
# <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center justify-between">
#     Sent Requests
# </h2>

withdraw_button = """
                                {sentRequests.length > 0 && (
                                    <button
                                        onClick={() => setBulkAction({ type: 'withdraw' })}
                                        disabled={withdrawAllSent.isPending}
                                        className="text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 disabled:opacity-50"
                                    >
                                        Withdraw All
                                    </button>
                                )}
"""

sent_header_pattern = r"(<h2 className=\"text-sm font-semibold[^>]*?>\s*Sent Requests.*?)(</h2>)"
# We need to insert inside the h2 if it's flex, or next to it. Let's see if it's flex items-center justify-between.
# Let's just find "Sent Requests"
# Better yet, search for "Sent Requests" exactly.

content = re.sub(
    r'(<h2[^>]*?>\s*Sent Requests\s*)(</h2>)',
    r'\1' + withdraw_button + r'\2',
    content
)

# Also we need to add "withdraw" to BulkAction type
# type BulkAction = { type: 'accept' | 'reject' | 'withdraw' };
content = content.replace("type: \"accept\" | \"reject\"", "type: \"accept\" | \"reject\" | \"withdraw\"")

# Add confirmWithdrawAll
confirm_withdraw = """
    const confirmWithdrawAll = useCallback(async () => {
        try {
            await withdrawAllSent.mutateAsync();
        } catch {
            toast.error("Failed to withdraw sent requests");
        }
    }, [withdrawAllSent]);
"""
content = content.replace("const confirmAcceptAll = useCallback", confirm_withdraw + "\n    const confirmAcceptAll = useCallback")

# And update the Dialog onConfirm
content = content.replace(
    'bulkAction?.type === "accept" ? confirmAcceptAll() : confirmRejectAll()',
    'bulkAction?.type === "withdraw" ? confirmWithdrawAll() : bulkAction?.type === "accept" ? confirmAcceptAll() : confirmRejectAll()'
)

# And update Dialog title/desc
content = content.replace(
    'bulkAction?.type === "accept" ? "Accept All Requests" : "Reject All Requests"',
    'bulkAction?.type === "withdraw" ? "Withdraw All Sent Requests" : bulkAction?.type === "accept" ? "Accept All Requests" : "Reject All Requests"'
)
content = content.replace(
    'bulkAction?.type === "accept"\n                                ? `Are you sure you want to accept all ${incomingRequests.length} pending requests?`\n                                : `Are you sure you want to reject all ${incomingRequests.length} pending requests?`',
    'bulkAction?.type === "withdraw"\n                                ? `Are you sure you want to withdraw all ${sentRequests.length} sent requests?`\n                                : bulkAction?.type === "accept"\n                                ? `Are you sure you want to accept all ${incomingRequests.length} pending requests?`\n                                : `Are you sure you want to reject all ${incomingRequests.length} pending requests?`'
)


with open("src/components/people/RequestsTab.tsx", "w") as f:
    f.write(content)

print("Added withdraw all UI!")
