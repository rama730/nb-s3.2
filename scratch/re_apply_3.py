import re

with open("src/components/people/RequestsTab.tsx", "r") as f:
    content = f.read()

# Add withdrawAllSent to destructuring
content = content.replace(
    "const { acceptRequest, rejectRequest, undoRejectRequest, cancelRequest, acceptAllIncoming, rejectAllIncoming, blockProfile } = useConnectionMutations();",
    "const { acceptRequest, rejectRequest, undoRejectRequest, cancelRequest, acceptAllIncoming, rejectAllIncoming, blockProfile, withdrawAllSent } = useConnectionMutations();"
)

# Add confirmWithdrawAll
confirm_code = """    const confirmRejectAll = () => {
        setBulkAction(null);
        toast.promise(rejectAllIncoming.mutateAsync(), {
            loading: "Rejecting all...",
            success: "All requests rejected",
            error: "Failed to reject requests",
        });
    };

    const confirmWithdrawAll = () => {
        setBulkAction(null);
        toast.promise(withdrawAllSent.mutateAsync(), {
            loading: "Withdrawing all...",
            success: "All requests withdrawn",
            error: "Failed to withdraw requests",
        });
    };"""

content = content.replace("""    const confirmRejectAll = () => {
        setBulkAction(null);
        toast.promise(rejectAllIncoming.mutateAsync(), {
            loading: "Rejecting all...",
            success: "All requests rejected",
            error: "Failed to reject requests",
        });
    };""", confirm_code)

# Add Withdraw All to Sent Requests header
sent_header_pattern = r'(<h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-4 flex items-center gap-2">\s*<Clock className="w-4 h-4 text-amber-500" />\s*Sent\s*</h2>)'
sent_header_replacement = """<div className="flex items-center justify-between mb-4">
                        <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                            <Clock className="w-4 h-4 text-amber-500" />
                            Sent
                        </h2>
                        {sentRequests.length > 0 && (
                            <button
                                onClick={() => setBulkAction({ type: "withdraw" })}
                                className="text-xs font-medium text-red-500 hover:text-red-600 transition-colors bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg dark:bg-red-500/10 dark:hover:bg-red-500/20"
                            >
                                Withdraw All
                            </button>
                        )}
                    </div>"""
content = re.sub(sent_header_pattern, sent_header_replacement, content)

# Update ConfirmDialog
confirm_dialog = """            <ConfirmDialog
                open={!!bulkAction}
                onOpenChange={(open) => { if (!open) setBulkAction(null); }}
                title={bulkAction?.type === "withdraw" ? "Withdraw All Sent Requests" : bulkAction?.type === "accept" ? "Accept All Requests" : "Reject All Requests"}
                description={bulkAction?.type === "withdraw" 
                    ? `Withdraw all ${sentRequests.length} sent requests?`
                    : bulkAction?.type === "accept"
                        ? `Accept all ${incomingRequests.length} incoming requests?`
                        : `Reject all ${incomingRequests.length} incoming requests? This cannot be undone in bulk.`}
                confirmLabel={bulkAction?.type === "withdraw" ? "Withdraw All" : bulkAction?.type === "accept" ? "Accept All" : "Reject All"}
                variant="default"
                onConfirm={() => bulkAction?.type === "withdraw" ? confirmWithdrawAll() : bulkAction?.type === "accept" ? confirmAcceptAll() : confirmRejectAll()}
            />"""
old_confirm_dialog = """            <ConfirmDialog
                open={!!bulkAction}
                onOpenChange={(open) => { if (!open) setBulkAction(null); }}
                title={bulkAction?.type === "accept" ? "Accept All Requests" : "Reject All Requests"}
                description={bulkAction?.type === "accept"
                    ? `Accept all ${incomingRequests.length} incoming requests?`
                    : `Reject all ${incomingRequests.length} incoming requests? This cannot be undone in bulk.`}
                confirmLabel={bulkAction?.type === "accept" ? "Accept All" : "Reject All"}
                variant={bulkAction?.type === "reject" ? "destructive" : "default"}
                onConfirm={bulkAction?.type === "accept" ? confirmAcceptAll : confirmRejectAll}
            />"""
content = content.replace(old_confirm_dialog, confirm_dialog)

# Fix layout shifts by wrapping slicing in useRef logic
pagination_pattern = r"(const \[\s*visibleIncomingCount,\s*setVisibleIncomingCount\s*\] = useState\(6\);\n\s*const \[\s*visibleSentCount,\s*setVisibleSentCount\s*\] = useState\(6\);)"
pagination_fix = """const [visibleIncomingCount, setVisibleIncomingCount] = useState(6);
    const [visibleSentCount, setVisibleSentCount] = useState(6);
    const incomingCountRef = React.useRef(visibleIncomingCount);
    const sentCountRef = React.useRef(visibleSentCount);
    React.useEffect(() => { incomingCountRef.current = visibleIncomingCount; }, [visibleIncomingCount]);
    React.useEffect(() => { sentCountRef.current = visibleSentCount; }, [visibleSentCount]);"""
content = re.sub(pagination_pattern, pagination_fix, content)

slice_pattern = r"const visibleIncomingRequests = incomingRequests\.slice\(0, visibleIncomingCount\);"
slice_fix = """const visibleIncomingRequests = incomingRequests.slice(0, Math.max(incomingCountRef.current, visibleIncomingCount, incomingRequests.length < incomingCountRef.current ? incomingRequests.length : 0));"""
content = re.sub(slice_pattern, slice_fix, content)

slice_pattern_sent = r"const visibleSentRequests = sentRequests\.slice\(0, visibleSentCount\);"
slice_fix_sent = """const visibleSentRequests = sentRequests.slice(0, Math.max(sentCountRef.current, visibleSentCount, sentRequests.length < sentCountRef.current ? sentRequests.length : 0));"""
content = re.sub(slice_pattern_sent, slice_fix_sent, content)

with open("src/components/people/RequestsTab.tsx", "w") as f:
    f.write(content)

