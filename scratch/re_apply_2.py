import re

with open("src/components/people/RequestsTab.tsx", "r") as f:
    content = f.read()

# Fix layout shifts by wrapping slicing in useRef logic
pagination_pattern = r"(const \[\s*visibleIncomingCount,\s*setVisibleIncomingCount\s*\] = useState\(6\);\n\s*const \[\s*visibleSentCount,\s*setVisibleSentCount\s*\] = useState\(6\);)"
pagination_fix = """const [visibleIncomingCount, setVisibleIncomingCount] = useState(6);
    const [visibleSentCount, setVisibleSentCount] = useState(6);
    const incomingCountRef = React.useRef(visibleIncomingCount);
    const sentCountRef = React.useRef(visibleSentCount);
    React.useEffect(() => { incomingCountRef.current = visibleIncomingCount; }, [visibleIncomingCount]);
    React.useEffect(() => { sentCountRef.current = visibleSentCount; }, [visibleSentCount]);"""
content = re.sub(pagination_pattern, pagination_fix, content)

slice_pattern = r"const visibleIncoming = incomingRequests\.slice\(0, visibleIncomingCount\);"
slice_fix = """const visibleIncoming = incomingRequests.slice(0, Math.max(incomingCountRef.current, visibleIncomingCount, incomingRequests.length < incomingCountRef.current ? incomingRequests.length : 0));"""
content = re.sub(slice_pattern, slice_fix, content)

slice_pattern_sent = r"const visibleSent = sentRequests\.slice\(0, visibleSentCount\);"
slice_fix_sent = """const visibleSent = sentRequests.slice(0, Math.max(sentCountRef.current, visibleSentCount, sentRequests.length < sentCountRef.current ? sentRequests.length : 0));"""
content = re.sub(slice_pattern_sent, slice_fix_sent, content)

# Add Withdraw All UI
withdraw_all_ui = """                        </div>
                        {sentRequests.length > 0 && (
                            <button
                                onClick={async () => {
                                    try {
                                        await withdrawAllSent.mutateAsync();
                                        toast.success("All sent requests withdrawn");
                                    } catch (e) {
                                        toast.error("Failed to withdraw requests");
                                    }
                                }}
                                disabled={withdrawAllSent.isPending}
                                className="text-xs text-zinc-500 hover:text-red-500 transition-colors"
                            >
                                {withdrawAllSent.isPending ? "Withdrawing..." : "Withdraw all"}
                            </button>
                        )}
                    </div>"""
content = content.replace("                        </div>\n                    </div>", withdraw_all_ui)

with open("src/components/people/RequestsTab.tsx", "w") as f:
    f.write(content)
