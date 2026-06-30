import re

with open("src/components/people/RequestsTab.tsx", "r") as f:
    content = f.read()

# Find visibleIncomingRequests logic
# We can just use a ref to track previous length
fix = """
    // Fix layout shifts by reducing visibleCount when items are removed
    const prevIncomingLengthRef = useRef(incomingRequests.length);
    const prevSentLengthRef = useRef(sentRequests.length);

    useEffect(() => {
        if (incomingRequests.length < prevIncomingLengthRef.current) {
            setIncomingLimit(prev => Math.max(5, prev - (prevIncomingLengthRef.current - incomingRequests.length)));
        }
        prevIncomingLengthRef.current = incomingRequests.length;
    }, [incomingRequests.length]);

    useEffect(() => {
        if (sentRequests.length < prevSentLengthRef.current) {
            setSentLimit(prev => Math.max(5, prev - (prevSentLengthRef.current - sentRequests.length)));
        }
        prevSentLengthRef.current = sentRequests.length;
    }, [sentRequests.length]);
"""

# Insert after const sentLimit
content = re.sub(
    r'(const \[sentLimit, setSentLimit\] = useState\(5\);)',
    r'\1\n' + fix,
    content
)

with open("src/components/people/RequestsTab.tsx", "w") as f:
    f.write(content)

print("Fixed pagination layout shift!")
