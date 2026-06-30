import re
import os

path = "/Users/chrama/.gemini/antigravity/brain/06a23ec8-dc2d-4509-a40c-c67b39c1b7b9/artifacts/task.md"

if not os.path.exists(path):
    print("Task file not found")
    exit(1)

with open(path, "r") as f:
    content = f.read()

# I will just write a script to mark what is done based on my memory.
content = content.replace("- [ ] Refactor `patchConnectionsRealtimeCaches`", "- [x] Refactor `patchConnectionsRealtimeCaches`")
content = content.replace("- [ ] Expose `useGlobalConnectionsRealtime`", "- [x] Expose `useGlobalConnectionsRealtime`")
content = content.replace("- [ ] Mount the realtime hook globally", "- [x] Mount the realtime hook globally")
content = content.replace("- [ ] Remove localized `useConnectionsRealtimeInvalidation`", "- [x] Remove localized `useConnectionsRealtimeInvalidation`")

content = content.replace("- [ ] Add `withdrawAllSentConnectionRequests()`", "- [x] Add `withdrawAllSentConnectionRequests()`")
content = content.replace("- [ ] Implement \"Withdraw All\" UI", "- [x] Implement \"Withdraw All\" UI")
content = content.replace("- [ ] Fix manual slice pagination state", "- [x] Fix manual slice pagination state")

content = content.replace("- [ ] Update `getConnectionsFeed` server action to apply PostgreSQL array filtering", "- [x] Update `getConnectionsFeed` server action to apply PostgreSQL array filtering")
content = content.replace("- [ ] Add `getConnectionTags()`, `bulkDisconnectConnections()`, and `bulkUpdateConnectionTags()`", "- [x] Add `getConnectionTags()`, `bulkDisconnectConnections()`, and `bulkUpdateConnectionTags()`")
content = content.replace("- [ ] Add `useConnectionTags` and `useBulkConnectionsActions` hooks", "- [x] Add `useConnectionTags` and `useBulkConnectionsActions` hooks")
content = content.replace("- [ ] Refactor `ConnectionsClient.tsx` to use server-side `tagFilter`", "- [x] Refactor `ConnectionsClient.tsx` to use server-side `tagFilter`")

content = content.replace("- [ ] Add dedicated server actions for `getMutualSuggestions()`", "- [x] Add dedicated server actions for `getMutualSuggestions()`")
content = content.replace("- [ ] Refactor `PeopleClient.tsx` to fetch lanes independently", "- [x] Refactor `PeopleClient.tsx` to fetch lanes independently")
content = content.replace("- [ ] Add `scoringBreakdown` tooltip inside `PersonCard.tsx`.", "- [x] Add `scoringBreakdown` tooltip inside `PersonCard.tsx`.")

with open(path, "w") as f:
    f.write(content)
print("Task updated")
