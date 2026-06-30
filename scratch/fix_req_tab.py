import re

with open("src/components/people/RequestsTab.tsx", "r") as f:
    content = f.read()

content = content.replace(
    "useEffect(() => { setIncomingLimit(REQUESTS_INITIAL_BATCH); }, [incomingRequests.length, viewerId]);",
    "useEffect(() => { setIncomingLimit(REQUESTS_INITIAL_BATCH); }, [viewerId]);"
)
content = content.replace(
    "useEffect(() => { setSentLimit(REQUESTS_INITIAL_BATCH); }, [sentRequests.length, viewerId]);",
    "useEffect(() => { setSentLimit(REQUESTS_INITIAL_BATCH); }, [viewerId]);"
)

with open("src/components/people/RequestsTab.tsx", "w") as f:
    f.write(content)

