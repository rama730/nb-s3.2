import { createClient } from '@/lib/supabase/server';
import MessagesClient from '@/components/chat/MessagesClient';
import { getConversations } from '@/app/actions/messaging';
import { db } from '@/lib/db';
import { profiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Prevent fetch if not logged in (though middleware protects this usually)
    let initialConversations: any[] = [];
    
    if (user) {
        const { conversations } = await getConversations();
        initialConversations = conversations || [];
    }

    const resolvedParams = await searchParams;
    const targetUserId = typeof resolvedParams.userId === 'string' ? resolvedParams.userId : null;
    let targetUser = null;

    if (targetUserId && user) {
        // Fetch target user profile
        const [profile] = await db.select({
            id: profiles.id,
            fullName: profiles.fullName,
            username: profiles.username,
            avatarUrl: profiles.avatarUrl,
        }).from(profiles).where(eq(profiles.id, targetUserId)).limit(1);
        
        targetUser = profile || null;
    }

    return (
        <MessagesClient 
            initialConversations={initialConversations} 
            targetUser={targetUser}
        />
    );
}
