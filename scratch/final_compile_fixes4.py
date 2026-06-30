import re

with open("src/app/actions/connections.ts", "r") as f:
    content = f.read()

# Fix 2043
content = content.replace(
    "return { success: false, items: [], error: 'Failed to load history' };",
    "return { success: false, items: [], groupedItems: [], error: 'Failed to load history' };"
)

# Remove groupedItems from mutual/role suggestions if it was added
content = re.sub(
    r"return \{ success: false, items: \[\], groupedItems: \[\], error: 'Not authenticated' \};",
    "return { success: false, items: [], error: 'Not authenticated' };",
    content
)

with open("src/app/actions/connections.ts", "w") as f:
    f.write(content)

