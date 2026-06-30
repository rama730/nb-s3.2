import re

with open("src/app/actions/connections.ts", "r") as f:
    content = f.read()

grouping_func = """
// ── Time grouping helper ────────────────────────────────────────────────
import { subDays, isToday, isYesterday } from "date-fns";
import type { ConnectionRequestHistoryItem } from "@/lib/connections/types";

export function groupHistoryByTimeOnServer(items: ConnectionRequestHistoryItem[]): { label: string; items: ConnectionRequestHistoryItem[] }[] {
    const today: ConnectionRequestHistoryItem[] = [];
    const yesterday: ConnectionRequestHistoryItem[] = [];
    const lastWeek: ConnectionRequestHistoryItem[] = [];
    const older: ConnectionRequestHistoryItem[] = [];

    const weekAgo = subDays(new Date(), 7);

    for (const item of items) {
        const date = new Date(item.eventAt);
        if (isToday(date)) today.push(item);
        else if (isYesterday(date)) yesterday.push(item);
        else if (date >= weekAgo) lastWeek.push(item);
        else older.push(item);
    }

    const groups: { label: string; items: ConnectionRequestHistoryItem[] }[] = [];
    if (today.length > 0) groups.push({ label: "Today", items: today });
    if (yesterday.length > 0) groups.push({ label: "Yesterday", items: yesterday });
    if (lastWeek.length > 0) groups.push({ label: "Last 7 days", items: lastWeek });
    if (older.length > 0) groups.push({ label: "Older", items: older });
    return groups;
}
"""

if "groupHistoryByTimeOnServer" not in content:
    content = content.replace("export async function getConnectionRequestHistory(", grouping_func + "\nexport async function getConnectionRequestHistory(")

    # Modify return type
    content = content.replace(
    """    items: ConnectionRequestHistoryItem[];
    nextCursor?: string | null;""",
    """    items: ConnectionRequestHistoryItem[];
    groupedItems: { label: string; items: ConnectionRequestHistoryItem[] }[];
    nextCursor?: string | null;"""
    )
    
    # Modify return payload
    content = content.replace(
    """                items: parsed,
                nextCursor,
                hasMore: items.length > effectiveLimit,
            };""",
    """                items: parsed,
                groupedItems: groupHistoryByTimeOnServer(parsed),
                nextCursor,
                hasMore: items.length > effectiveLimit,
            };"""
    )

with open("src/app/actions/connections.ts", "w") as f:
    f.write(content)
