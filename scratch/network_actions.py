import re

with open("src/app/actions/connections.ts", "r") as f:
    content = f.read()

# 1. Update getConnectionsFeed interface to include tagFilter
content = content.replace(
    "    historyFilters?: HistoryFilters;\n    requestSortBy?: 'recent' | 'mutual' | 'oldest';\n}",
    "    historyFilters?: HistoryFilters;\n    requestSortBy?: 'recent' | 'mutual' | 'oldest';\n    tagFilter?: string;\n}"
)

# 2. Extract tagFilter from input
content = content.replace(
    "        const { tab, limit, cursor, search, sortBy, filters, historyFilters, requestSortBy } = input;",
    "        const { tab, limit, cursor, search, sortBy, filters, historyFilters, requestSortBy, tagFilter } = input;"
)

# 3. Add tagFilter condition to network tab
# We need to find: `if (tab === 'network') { baseConditions.push(eq(connections.status, 'accepted')); }`
network_cond_pattern = r"(if \(tab === 'network'\) \{\s*baseConditions\.push\(eq\(connections\.status, 'accepted'\)\);\s*\})"
content = re.sub(
    network_cond_pattern,
    r"\1\n        if (tab === 'network' && tagFilter) {\n            baseConditions.push(sql`${tagFilter} = ANY(${connections.tags})`);\n        }",
    content
)

# 4. Add getConnectionTags
new_actions = """
export async function getConnectionTags(): Promise<{ success: boolean; tags: string[]; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, tags: [], error: 'Not authenticated' };

        const rows = await db.execute(sql`
            SELECT DISTINCT unnest(tags) as tag
            FROM connections
            WHERE (requester_id = ${user.id} OR addressee_id = ${user.id})
              AND status = 'accepted'
              AND tags IS NOT NULL
        `);
        return { success: true, tags: rows.map(r => r.tag as string) };
    } catch (error) {
        logger.error('connections.get_tags_failed', { error });
        return { success: false, tags: [], error: 'Failed to fetch tags' };
    }
}

export async function bulkDisconnectConnections(connectionIds: string[]): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        
        if (!connectionIds.length) return { success: true };

        await db.delete(connections)
            .where(
                and(
                    inArray(connections.id, connectionIds),
                    or(eq(connections.requesterId, user.id), eq(connections.addresseeId, user.id))
                )
            );
        return { success: true };
    } catch (error) {
        logger.error('connections.bulk_disconnect_failed', { error });
        return { success: false, error: 'Failed to disconnect' };
    }
}

export async function bulkUpdateConnectionTags(connectionIds: string[], tags: string[]): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        
        if (!connectionIds.length) return { success: true };

        await db.update(connections)
            .set({ tags, updatedAt: new Date() })
            .where(
                and(
                    inArray(connections.id, connectionIds),
                    or(eq(connections.requesterId, user.id), eq(connections.addresseeId, user.id))
                )
            );
        return { success: true };
    } catch (error) {
        logger.error('connections.bulk_update_tags_failed', { error });
        return { success: false, error: 'Failed to update tags' };
    }
}
"""

content = content + new_actions

with open("src/app/actions/connections.ts", "w") as f:
    f.write(content)

print("Added network actions!")
