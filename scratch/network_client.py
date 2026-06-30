import re

with open("src/components/people/ConnectionsClient.tsx", "r") as f:
    content = f.read()

# Replace client-side tag logic
# 1. Update imports
import_stmt = 'import { useConnections, useConnectionTags, useBulkConnectionsActions } from "@/hooks/useConnections";\n'
content = content.replace('import { useConnections } from "@/hooks/useConnections";', import_stmt)

# 2. Update the hook call
content = content.replace(
    'const { data: connectionsData, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useConnections(20, searchQuery);',
    'const { data: connectionsData, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useConnections(20, searchQuery, "recent", tagFilter);'
)

# 3. Add tags hook
content = content.replace(
    'const connections = useMemo',
    'const { data: allTags = [] } = useConnectionTags();\n    const { disconnect, updateTags } = useBulkConnectionsActions();\n\n    const connections = useMemo'
)

# 4. Remove client-side tag filtering
# Find: `const items = pages.flatMap((page) => page.items || []);`
# Then: `if (!tagFilter) return items; return items.filter((conn) => conn.tags?.includes(tagFilter));`
client_filter_pattern = r"const items = pages\.flatMap\(\(page\) => page\.items \|\| \[\]\);\n\s*if \(\!tagFilter\) return items;\n\s*return items\.filter\(\(conn\) => conn\.tags\?\.includes\(tagFilter\)\);"
content = re.sub(
    client_filter_pattern,
    r"return pages.flatMap((page) => page.items || []);",
    content
)

# 5. Remove dynamic allTags calculation
tags_pattern = r"const allTags = useMemo\(\(\) => \{\n\s*const tags = new Set<string>\(\);\n\s*connections\.forEach\(\(conn\) => \{\n\s*conn\.tags\?\.forEach\(\(tag\) => tags\.add\(tag\)\);\n\s*\}\);\n\s*return Array\.from\(tags\)\.sort\(\);\n\s*\}, \[connections\]\);"
content = re.sub(tags_pattern, "", content)

# 6. Expand bulk actions
# Find `<MessageSquare className="w-3.5 h-3.5" />\n                                Message\n                            </button>`
# Add Disconnect and Manage Tags buttons
bulk_buttons = """<MessageSquare className="w-3.5 h-3.5" />
                                Message
                            </button>
                            <button
                                onClick={async () => {
                                    try {
                                        await disconnect.mutateAsync(Array.from(selectedIds));
                                        toast.success(`Disconnected ${selectedIds.size} connections`);
                                        setSelectionMode(false);
                                        setSelectedIds(new Set());
                                    } catch {
                                        toast.error("Failed to disconnect");
                                    }
                                }}
                                disabled={disconnect.isPending}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 text-sm font-medium transition-colors"
                            >
                                Disconnect
                            </button>"""

content = content.replace(
    '<MessageSquare className="w-3.5 h-3.5" />\n                                Message\n                            </button>',
    bulk_buttons
)


with open("src/components/people/ConnectionsClient.tsx", "w") as f:
    f.write(content)

print("Updated ConnectionsClient!")
