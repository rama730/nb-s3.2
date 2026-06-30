import re

with open("src/app/actions/connections.ts", "r") as f:
    content = f.read()

# 1. Import Zod at the top
if "import { z }" not in content:
    content = content.replace('import { db } from "@/lib/db";', 'import { db } from "@/lib/db";\nimport { z } from "zod";')

# 2. bulkDisconnectConnections
old_bulk_disconnect = """export async function bulkDisconnectConnections(connectionIds: string[]): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        
        if (!connectionIds.length) return { success: true };"""

new_bulk_disconnect = """export async function bulkDisconnectConnections(connectionIds: string[]): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        
        // Zod validation for bulk action
        z.array(z.string()).max(100).parse(connectionIds);
        
        if (!connectionIds.length) return { success: true };"""

content = content.replace(old_bulk_disconnect, new_bulk_disconnect)

# 3. bulkUpdateConnectionTags
old_bulk_update_tags = """export async function bulkUpdateConnectionTags(connectionIds: string[], tags: string[]): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        
        if (!connectionIds.length) return { success: true };"""

new_bulk_update_tags = """export async function bulkUpdateConnectionTags(connectionIds: string[], tags: string[]): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        
        // Zod validation for bulk tags
        z.array(z.string()).max(100).parse(connectionIds);
        z.array(z.string()).max(100).parse(tags);
        
        if (!connectionIds.length) return { success: true };"""

content = content.replace(old_bulk_update_tags, new_bulk_update_tags)

# 4. getConnectionsFeed
old_get_feed = """export async function getConnectionsFeed(input: ConnectionsFeedInput) {
    const user = await getAuthUser();"""

new_get_feed = """const connectionsFeedInputSchema = z.object({
    tab: z.enum(['network', 'discover', 'requests', 'stats']).catch('discover' as any),
    limit: z.number().max(100).optional(),
    cursor: z.string().optional(),
    search: z.string().max(100).optional(),
    sortBy: z.enum(['recent', 'name', 'oldest']).optional(),
    filters: z.any().optional(),
    historyFilters: z.any().optional(),
    requestSortBy: z.enum(['recent', 'mutual', 'oldest']).optional(),
    targetUserId: z.string().optional()
});

export async function getConnectionsFeed(input: ConnectionsFeedInput) {
    // Validate input boundaries
    connectionsFeedInputSchema.parse(input);
    
    const user = await getAuthUser();"""

content = content.replace(old_get_feed, new_get_feed)

# 5. Non-null assertions
# line 1562 (approx): const ownerProjects = projectsByOwner.get(project.ownerId)!;
content = content.replace(
    "const ownerProjects = projectsByOwner.get(project.ownerId)!;",
    "const ownerProjects = projectsByOwner.get(project.ownerId) ?? [];"
)

# line 1666 (approx): if (projectsByOwner.has(scored[i].id) && projectsByOwner.get(scored[i].id)!.length === 0)
content = content.replace(
    "if (projectsByOwner.has(scored[i].id) && projectsByOwner.get(scored[i].id)!.length === 0)",
    "if (projectsByOwner.has(scored[i].id) && projectsByOwner.get(scored[i].id)?.length === 0)"
)

with open("src/app/actions/connections.ts", "w") as f:
    f.write(content)

