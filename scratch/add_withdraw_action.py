import re

with open("src/app/actions/connections.ts", "r") as f:
    content = f.read()

action = """
export async function withdrawAllSentConnectionRequests() {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        await db.delete(connections).where(
            and(
                eq(connections.requesterId, user.id),
                eq(connections.status, 'pending')
            )
        );
        return { success: true };
    } catch (error) {
        console.error('connections.withdraw_all_sent_failed', { error });
        return { success: false, error: 'Failed to withdraw requests' };
    }
}
"""

if "withdrawAllSentConnectionRequests" not in content:
    content = content + action
    with open("src/app/actions/connections.ts", "w") as f:
        f.write(content)
