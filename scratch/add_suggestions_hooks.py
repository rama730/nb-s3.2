import re

with open("src/hooks/useConnections.ts", "r") as f:
    content = f.read()

# Add import
content = content.replace("getConnectionTags,", "getConnectionTags, getMutualSuggestions, getRoleSuggestions,")

hooks = """
export function useMutualSuggestions(limit = 6) {
    return useQuery({
        queryKey: ['connections', 'suggestions', 'mutual', limit],
        queryFn: async () => {
            const res = await getMutualSuggestions(limit);
            if (!res.success) throw new Error(res.error);
            return res.items;
        }
    });
}

export function useRoleSuggestions(limit = 6) {
    return useQuery({
        queryKey: ['connections', 'suggestions', 'role', limit],
        queryFn: async () => {
            const res = await getRoleSuggestions(limit);
            if (!res.success) throw new Error(res.error);
            return res.items;
        }
    });
}
"""

content = content + hooks

with open("src/hooks/useConnections.ts", "w") as f:
    f.write(content)

print("Added suggestion hooks!")
