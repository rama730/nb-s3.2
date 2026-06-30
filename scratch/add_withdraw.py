import re

with open("src/hooks/useConnections.ts", "r") as f:
    content = f.read()

# Add withdrawAllSent to useConnectionMutations return
target = """    const result = useMemo(() => ({
        sendRequest,
        cancelRequest,
        acceptRequest,
        rejectRequest,"""

replacement = """    const result = useMemo(() => ({
        sendRequest,
        cancelRequest,
        withdrawAllSent,
        acceptRequest,
        rejectRequest,"""

content = content.replace(target, replacement)

with open("src/hooks/useConnections.ts", "w") as f:
    f.write(content)

print("Added withdrawAllSent to return")
