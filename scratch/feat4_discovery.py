import re

# 1. Update connections.ts to accept search
with open("src/app/actions/connections.ts", "r") as f:
    content = f.read()

content = content.replace("export async function getMutualSuggestions(limit: number = 6):", "export async function getMutualSuggestions(limit: number = 6, search?: string):")
content = content.replace("getConnectionsFeed({ tab: 'discover', limit, filters: { hasMutuals: true, available: true } })", "getConnectionsFeed({ tab: 'discover', limit, search, filters: { hasMutuals: true, available: true } })")

content = content.replace("export async function getRoleSuggestions(limit: number = 6):", "export async function getRoleSuggestions(limit: number = 6, search?: string):")
content = content.replace("getConnectionsFeed({ tab: 'discover', limit, filters: { hasSharedProjects: true, available: true } })", "getConnectionsFeed({ tab: 'discover', limit, search, filters: { hasSharedProjects: true, available: true } })")

with open("src/app/actions/connections.ts", "w") as f:
    f.write(content)

# 2. Update useConnections.ts to accept search
with open("src/hooks/useConnections.ts", "r") as f:
    content = f.read()

content = content.replace("export function useMutualSuggestions(limit = 6) {", "export function useMutualSuggestions(limit = 6, search?: string) {")
content = content.replace("queryKey: ['connections', 'mutual-suggestions', limit],", "queryKey: ['connections', 'mutual-suggestions', limit, search],")
content = content.replace("queryFn: () => getMutualSuggestions(limit),", "queryFn: () => getMutualSuggestions(limit, search),")

content = content.replace("export function useRoleSuggestions(limit = 6) {", "export function useRoleSuggestions(limit = 6, search?: string) {")
content = content.replace("queryKey: ['connections', 'role-suggestions', limit],", "queryKey: ['connections', 'role-suggestions', limit, search],")
content = content.replace("queryFn: () => getRoleSuggestions(limit),", "queryFn: () => getRoleSuggestions(limit, search),")

with open("src/hooks/useConnections.ts", "w") as f:
    f.write(content)

# 3. Update PeopleClient.tsx
with open("src/components/people/PeopleClient.tsx", "r") as f:
    content = f.read()

content = content.replace("const { mutualProfiles, isLoading: isMutualLoading } = useMutualSuggestions(6);", "const { mutualProfiles, isLoading: isMutualLoading } = useMutualSuggestions(6, debouncedSearch);")
content = content.replace("const { roleProfiles, isLoading: isRoleLoading } = useRoleSuggestions(6);", "const { roleProfiles, isLoading: isRoleLoading } = useRoleSuggestions(6, debouncedSearch);")

# Remove !isSearching wrapper around lanes
lanes_wrapper_old = """                <>
                    {/* ── Topic Lanes (browse mode only) ── */}
                    {!isSearching && (
                        <>
                            <TopicLane
                                title="People You May Know\""""
lanes_wrapper_new = """                <>
                    {/* ── Topic Lanes (contextual) ── */}
                    <>
                            <TopicLane
                                title="People You May Know\""""
content = content.replace(lanes_wrapper_old, lanes_wrapper_new)

# Remove the closing brace of the wrapper
closing_old = """                            />
                        </>
                    )}

                    {/* ── Main Feed ── */}
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xl font-bold text-zinc-900 dark:text-white">
                            {isSearching ? "Search Results" : "Discover"}
                        </h2>"""
closing_new = """                            />
                        </>

                    {/* ── Main Feed ── */}
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xl font-bold text-zinc-900 dark:text-white">
                            {isSearching ? "Search Results" : "Discover"}
                        </h2>"""
content = content.replace(closing_old, closing_new)

with open("src/components/people/PeopleClient.tsx", "w") as f:
    f.write(content)

