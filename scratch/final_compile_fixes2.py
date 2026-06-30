import re

with open("src/app/actions/connections.ts", "r") as f:
    content = f.read()

content = content.replace('import type { ConnectionRequestHistoryItem } from "@/lib/connections/types";', '')

# Fix groupedItems
content = re.sub(
    r"items: \[\],\s*error: 'Failed to fetch connection request history'",
    "items: [], groupedItems: [], error: 'Failed to fetch connection request history'",
    content
)
content = re.sub(
    r"nextCursor,\n\s*hasMore: items\.length > effectiveLimit,\n\s*\};",
    "groupedItems: groupHistoryByTimeOnServer(parsed),\n                nextCursor,\n                hasMore: items.length > effectiveLimit,\n            };",
    content
)
# Fix discover 
content = content.replace("groupedItems: [], error: 'Not authenticated' }", "error: 'Not authenticated' }")
content = re.sub(r"return \{ success: false, items: \[\], (groupedItems: \[\], )?error: 'Not authenticated' \};", "return { success: false, items: [], error: 'Not authenticated' };", content)
content = re.sub(r"return \{ success: false, items: \[\], (groupedItems: \[\], )?error: 'Failed to fetch mutuals' \};", "return { success: false, items: [], error: 'Failed to fetch mutuals' };", content)
content = re.sub(r"return \{ success: false, items: \[\], (groupedItems: \[\], )?error: 'Failed to fetch role suggestions' \};", "return { success: false, items: [], error: 'Failed to fetch role suggestions' };", content)
content = re.sub(r"return \{ success: false, items: \[\], error: 'Not authenticated' \};", "return { success: false, items: [], groupedItems: [], error: 'Not authenticated' };", content, count=1) # Only for history


with open("src/app/actions/connections.ts", "w") as f:
    f.write(content)

with open("src/components/people/PersonCard.tsx", "r") as f:
    content = f.read()

content = re.sub(
    r"function PersonCard\(\{(.*?)\}: PersonCardProps\) \{",
    lambda m: "function PersonCard({" + m.group(1).replace("onDisconnect,", "onDisconnect, onBlock,") + "}: PersonCardProps) {",
    content,
    flags=re.DOTALL
)

content = content.replace("const handleBlock = async () => {", "const [isBlocking, setIsBlocking] = React.useState(false);\n    const handleBlock = async () => {")

with open("src/components/people/PersonCard.tsx", "w") as f:
    f.write(content)

