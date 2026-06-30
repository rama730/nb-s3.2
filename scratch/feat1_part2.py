import re

with open("src/hooks/useConnections.ts", "r") as f:
    content = f.read()

# Add to RequestHistoryPage
content = content.replace("export type RequestHistoryPage = {", "export type RequestHistoryPage = {\n    groupedConnectionItems?: { label: string; items: RequestHistoryConnectionItem[] }[];")

# Populate in queryFn
replacement = """            const groupedConnectionItems = connectionsHistory.success && 'groupedItems' in connectionsHistory
                ? (connectionsHistory as any).groupedItems.map((group: any) => ({
                    label: group.label,
                    items: group.items.map((item: any) => ({ ...item, source: 'connection' as const }))
                }))
                : [];

            return {
                items,
                groupedConnectionItems,"""

content = content.replace("            return {\n                items,", replacement)

with open("src/hooks/useConnections.ts", "w") as f:
    f.write(content)

with open("src/components/people/RequestsTab.tsx", "r") as f:
    content = f.read()

# Update groupedConnectionHistory in RequestsTab
old_grouped = """    const groupedConnectionHistory = useMemo(() => groupHistoryByTime(connectionHistoryItems), [connectionHistoryItems]);"""
new_grouped = """    const groupedConnectionHistory = useMemo(() => {
        const groupsMap = new Map<string, any[]>();
        for (const page of requestHistoryData?.pages ?? []) {
            if (page.groupedConnectionItems) {
                for (const group of page.groupedConnectionItems) {
                    if (!groupsMap.has(group.label)) groupsMap.set(group.label, []);
                    groupsMap.get(group.label)!.push(...group.items);
                }
            }
        }
        const result = Array.from(groupsMap.entries()).map(([label, items]) => ({ label, items }));
        // Slice the items to respect historyLimit (approximate)
        let totalCount = 0;
        for (const group of result) {
            if (totalCount >= historyLimit) { group.items = []; continue; }
            if (totalCount + group.items.length > historyLimit) {
                group.items = group.items.slice(0, historyLimit - totalCount);
            }
            totalCount += group.items.length;
        }
        return result.filter(g => g.items.length > 0);
    }, [requestHistoryData?.pages, historyLimit]);"""

content = content.replace(old_grouped, new_grouped)

with open("src/components/people/RequestsTab.tsx", "w") as f:
    f.write(content)
