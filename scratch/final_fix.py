import re

# 1. ConnectionsClient.tsx
with open("src/components/people/ConnectionsClient.tsx", "r") as f:
    content = f.read()

# Re-add allTags logic
if "const allTags =" not in content:
    all_tags = """
    // Flatten pages — no client-side sort needed (#18)
    const connections = useMemo(() => {
        const items = connectionsData?.pages.flatMap((page) => page.items) || [];
        const valid = items.filter((item) => Boolean(item.otherUser));
        return valid;
    }, [connectionsData]);

    const allTags = [];
    """
    content = content.replace(
    """    const connections = useMemo(() => {
        const items = connectionsData?.pages.flatMap((page) => page.items) || [];
        const valid = items.filter((item) => Boolean(item.otherUser));
        return valid;
    }, [connectionsData]);""", all_tags)

if "const { disconnect } = useConnectionMutations();" not in content:
    content = content.replace("const stats = statsData || {", "const { disconnect } = useConnectionMutations();\n    const stats = statsData || {")

with open("src/components/people/ConnectionsClient.tsx", "w") as f:
    f.write(content)

# 2. RequestsTab.tsx
with open("src/components/people/RequestsTab.tsx", "r") as f:
    content = f.read()

content = content.replace('useState<{ type: "accept" | "reject" } | null>(null);', 'useState<{ type: "accept" | "reject" | "withdraw" } | null>(null);')

with open("src/components/people/RequestsTab.tsx", "w") as f:
    f.write(content)

# 3. connections.ts
with open("src/app/actions/connections.ts", "r") as f:
    content = f.read()

content = content.replace("logger.error", "console.error")
if "import type { DiscoverConnectionItem }" not in content:
    content = content.replace("import type { ConnectionStats } from '@/lib/connections/types';", "import type { ConnectionStats } from '@/lib/connections/types';\nimport type { DiscoverConnectionItem } from '@/hooks/useConnections';")

with open("src/app/actions/connections.ts", "w") as f:
    f.write(content)
