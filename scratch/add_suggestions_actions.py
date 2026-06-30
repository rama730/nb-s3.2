import re

with open("src/app/actions/connections.ts", "r") as f:
    content = f.read()

actions = """
export async function getMutualSuggestions(limit: number = 6): Promise<{ success: boolean; items: DiscoverConnectionItem[]; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, items: [], error: 'Not authenticated' };

        // For simplicity, we can fetch from getConnectionsFeed with hasMutuals filter
        const result = await getConnectionsFeed({ tab: 'discover', limit, filters: { hasMutuals: true, available: true } });
        if (!result.success) throw new Error(result.error);
        return { success: true, items: (result.items || []) as DiscoverConnectionItem[] };
    } catch (error) {
        return { success: false, items: [], error: 'Failed to fetch mutuals' };
    }
}

export async function getRoleSuggestions(limit: number = 6): Promise<{ success: boolean; items: DiscoverConnectionItem[]; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, items: [], error: 'Not authenticated' };

        // For simplicity, we can fetch from getConnectionsFeed with hasSharedProjects or seniorPlus filter
        const result = await getConnectionsFeed({ tab: 'discover', limit, filters: { hasSharedProjects: true, available: true } });
        if (!result.success) throw new Error(result.error);
        return { success: true, items: (result.items || []) as DiscoverConnectionItem[] };
    } catch (error) {
        return { success: false, items: [], error: 'Failed to fetch roles' };
    }
}
"""

content = content + actions

with open("src/app/actions/connections.ts", "w") as f:
    f.write(content)

print("Added suggestion actions!")
