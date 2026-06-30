import re

with open("src/app/actions/connections.ts", "r") as f:
    content = f.read()

# We only want to replace the FIRST occurrence of "items: [], error: 'Not authenticated' }"
# or specifically the one in getConnectionRequestHistory.

# Let's use string split on "export async function getConnectionRequestHistory("
parts = content.split("export async function getConnectionRequestHistory(")

if len(parts) > 1:
    part2 = parts[1]
    # Replace the first occurrence of the Not authenticated error in part2
    part2 = part2.replace(
        "return { success: false, items: [], error: 'Not authenticated' };",
        "return { success: false, items: [], groupedItems: [], error: 'Not authenticated' };",
        1
    )
    content = parts[0] + "export async function getConnectionRequestHistory(" + part2

with open("src/app/actions/connections.ts", "w") as f:
    f.write(content)

