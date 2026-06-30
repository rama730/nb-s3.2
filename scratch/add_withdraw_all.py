import re

with open("src/app/actions/connections.ts", "r") as f:
    content = f.read()

# We need to add the new server action.
# Let's see if bulk actions already exist to put it next to them.
new_action = """
export async function withdrawAllSentConnectionRequests(): Promise<{ success: boolean; count?: number; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        
        const rate = await consumeRateLimit(`connections-bulk-withdraw:${user.id}`, 10, 60);
        if (!rate.allowed) {
            return { success: false, error: 'Too many actions. Please wait and try again.' };
        }

        const updatedRows = await db
            .update(connections)
            .set({
                status: 'cancelled',
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(connections.requesterId, user.id),
                    eq(connections.status, 'pending')
                )
            )
            .returning({ id: connections.id });

        return { success: true, count: updatedRows.length };
    } catch (error) {
        logger.error('connections.withdraw_all_failed', { error, userId: user?.id });
        return { success: false, error: 'Failed to withdraw requests.' };
    }
}
"""

content = content + new_action

with open("src/app/actions/connections.ts", "w") as f:
    f.write(content)

print("Added withdrawAllSentConnectionRequests!")
