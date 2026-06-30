import re

with open("src/hooks/useConnections.ts", "r") as f:
    content = f.read()

# Fix `,,\n        withdrawAllSent` -> `,`
content = content.replace(",,\\n        withdrawAllSent", ",")

# Fix `,\n        withdrawAllSent` in places where it shouldn't be.
# Wait, we know the EXACT valid place for `withdrawAllSent` in the return object:
# It should be inside useConnectionMutations return:
# return {
#         sendRequest,
#         cancelRequest,
#         withdrawAllSent,
#         acceptRequest,
#         undoRejectRequest,
#         rejectRequest,
#         dismissSuggestion,
#         undoDismissSuggestion,
#         removeConnection,
#         acceptAllIncoming,
#         rejectAllIncoming,
#         blockProfile,
#     };
# But the regex did:
# content = re.sub(return_pattern, r"\1,\n        withdrawAllSent\2", content)
# So it changed `return { ... }` into `return { ... ,\n        withdrawAllSent\n    };`

# Let's just fix the syntax errors.
content = re.sub(r',\s*,\s*withdrawAllSent', ',', content)
content = re.sub(r'withdrawAllSent\s*\}', '}', content)

with open("src/hooks/useConnections.ts", "w") as f:
    f.write(content)

print("Fixed syntax")
