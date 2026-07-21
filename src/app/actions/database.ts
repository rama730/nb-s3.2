'use server'

import { eq } from 'drizzle-orm'

import { db } from '@/lib/db'
import { profiles } from '@/lib/db/schema'
import { createClient } from '@/lib/supabase/server'

/**
 * Ensure user has a profile (called after login)
 */
export async function ensureUserProfile(): Promise<{ success: boolean; hasProfile: boolean }> {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return { success: false, hasProfile: false }
        }

        const [profile] = await db
            .select({ id: profiles.id, username: profiles.username })
            .from(profiles)
            .where(eq(profiles.id, user.id))
            .limit(1)

        // If no profile, create one
        if (!profile) {
            await db
                .insert(profiles)
                .values({
                    id: user.id,
                    email: user.email!,
                    fullName: user.user_metadata?.full_name || user.user_metadata?.name || null,
                    avatarUrl: user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
                })
                .onConflictDoNothing()

            const [existingProfile] = await db
                .select({ username: profiles.username })
                .from(profiles)
                .where(eq(profiles.id, user.id))
                .limit(1)

            return { success: true, hasProfile: !!existingProfile?.username }
        }

        return { success: true, hasProfile: !!profile.username }
    } catch (error) {
        console.error('Error ensuring profile:', error)
        return { success: false, hasProfile: false }
    }
}
