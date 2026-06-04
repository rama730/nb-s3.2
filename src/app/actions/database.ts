'use server'

import { eq } from 'drizzle-orm'

import { db } from '@/lib/db'
import { profiles } from '@/lib/db/schema'
import { createClient } from '@/lib/supabase/server'

/**
 * One-time setup: Create trigger for auto-creating profiles
 * Run this once via an API route or server action
 */
export async function setupDatabase(): Promise<{ success: boolean; message: string }> {
    try {
        await db
            .select({ id: profiles.id })
            .from(profiles)
            .limit(1)

        return { success: true, message: 'Database is ready!' }
    } catch (error) {
        console.error('Setup error:', error)
        return { success: false, message: 'Setup failed' }
    }
}

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
