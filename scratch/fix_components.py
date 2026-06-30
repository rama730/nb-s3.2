import re

# 1. ConnectionsClient.tsx
with open("src/components/people/ConnectionsClient.tsx", "r") as f:
    content = f.read()

# Fix duplicate `disconnect`
content = content.replace("const { disconnect } = useConnectionMutations();", "")

# Fix duplicate `allTags`
all_tags_memo = """    // Collect unique tags for filter dropdown (#15)
    const allTags = useMemo(() => {
        const tagSet = new Set<string>();
        const items = connectionsData?.pages.flatMap((page) => page.items) || [];
        for (const item of items) {
            if (item.tags) {
                for (const tag of item.tags) tagSet.add(tag);
            }
        }
        return Array.from(tagSet).sort();
    }, [connectionsData]);"""
content = content.replace(all_tags_memo, "")

# Fix tag argument type error in map
content = content.replace("allTags.map((tag) => (", "allTags.map((tag: string) => (")
# Wait, allTags should already be string[] if it's from useConnectionTags()
# But useConnectionTags might not be imported correctly. Let's fix imports
content = content.replace('import { useConnections, useConnectionTags, useBulkConnectionsActions, useConnectionStats, useConnectionMutations } from "@/hooks/useConnections";', 
                          'import { useConnections, useConnectionStats, useConnectionMutations, useConnectionTags, useBulkConnectionsActions } from "@/hooks/useConnections";')

# Ensure imports are there
if "useConnectionTags" not in content:
    content = content.replace('import { useConnections, useConnectionStats, useConnectionMutations } from "@/hooks/useConnections";',
                              'import { useConnections, useConnectionStats, useConnectionMutations, useConnectionTags, useBulkConnectionsActions } from "@/hooks/useConnections";')

# The error TS2345: Argument of type 'string[]' is not assignable to parameter of type 'string'.
# at `ConnectionsClient.tsx(335,70)` -> `await disconnect.mutateAsync(Array.from(selectedIds));`
# `disconnect` from `useBulkConnectionsActions` expects `string[]`.
# Let's verify what we defined: `mutationFn: async (ids: string[]) => { ... }`
# Wait, `useConnectionMutations().disconnect` expects `string`. But we replaced `useConnectionMutations().disconnect` with `useBulkConnectionsActions().disconnect`!
# The confirm dialog `confirmDisconnect` calls `disconnect.mutateAsync(disconnectTarget.id)`. That passes a string!
# So we need both `disconnect` and `bulkDisconnect`.
content = content.replace("const { disconnect, updateTags } = useBulkConnectionsActions();", "const { disconnect: bulkDisconnect, updateTags } = useBulkConnectionsActions();\n    const { disconnect } = useConnectionMutations();")
content = content.replace("await disconnect.mutateAsync(Array.from(selectedIds));", "await bulkDisconnect.mutateAsync(Array.from(selectedIds));")
content = content.replace("disabled={disconnect.isPending}", "disabled={bulkDisconnect.isPending}")

with open("src/components/people/ConnectionsClient.tsx", "w") as f:
    f.write(content)

# 2. PeopleClient.tsx
with open("src/components/people/PeopleClient.tsx", "r") as f:
    content = f.read()

# Fix imports
if "useMutualSuggestions" not in content:
    content = content.replace('import { useConnectionMutations, useSuggestedPeople } from "@/hooks/useConnections";',
                              'import { useConnectionMutations, useSuggestedPeople, useMutualSuggestions, useRoleSuggestions } from "@/hooks/useConnections";')

with open("src/components/people/PeopleClient.tsx", "w") as f:
    f.write(content)

# 3. PersonCard.tsx
with open("src/components/people/PersonCard.tsx", "r") as f:
    content = f.read()

content = content.replace("ExternalLink, X,", "ExternalLink, X, MoreHorizontal, ShieldAlert,")
if "MoreHorizontal" not in content:
    content = content.replace("ExternalLink, X", "ExternalLink, X, MoreHorizontal, ShieldAlert")

with open("src/components/people/PersonCard.tsx", "w") as f:
    f.write(content)

