import re

with open("src/app/actions/connections.ts", "r") as f:
    content = f.read()

content = content.replace("return { success: true, items, nextCursor, hasMore };", "return { success: true, items, groupedItems: groupHistoryByTimeOnServer(items), nextCursor, hasMore };")
content = content.replace("return { success: false, items: [], error: 'Failed to fetch request history' };", "return { success: false, items: [], groupedItems: [], error: 'Failed to fetch request history' };")
content = content.replace("items: [], error: 'Not authenticated' }", "items: [], error: 'Not authenticated' }") # Keep as is, it's discover logic
# But actually let's just make the return type of `getConnectionRequestHistory` correct.
# Wait, I already added groupedItems: [] to 'Failed to fetch request history'

with open("src/app/actions/connections.ts", "w") as f:
    f.write(content)

with open("src/components/people/PersonCard.tsx", "r") as f:
    content = f.read()

content = content.replace("const [isBlocking, setIsBlocking] = React.useState(false);", "")
content = content.replace("const [isDisconnecting, setIsDisconnecting] = useState(false);", "const [isDisconnecting, setIsDisconnecting] = useState(false);\n    const [isBlocking, setIsBlocking] = useState(false);")

with open("src/components/people/PersonCard.tsx", "w") as f:
    f.write(content)

