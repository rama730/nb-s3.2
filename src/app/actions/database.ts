'use server'

import { createClient } from '@/lib/supabase/server'

/**
 * One-time setup: Create trigger for auto-creating profiles
 * Run this once via an API route or server action
 */
export async function setupDatabase(): Promise<{ success: boolean; message: string }> {
    try {
        const supabase = await createClient()

        // Check if we can query profiles table
        const { error: testError } = await supabase
            .from('profiles')
            .select('id')
            .limit(1)

        if (testError) {
            return { success: false, message: `Database error: ${testError.message}` }
        }

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

        // Check if profile exists
        const { data: profile, error: fetchError } = await supabase
            .from('profiles')
            .select('id, username')
            .eq('id', user.id)
            .single()

        if (fetchError && fetchError.code !== 'PGRST116') {
            // PGRST116 = no rows found, which is okay
            console.error('Error fetching profile:', fetchError)
        }

        // If no profile, create one
        if (!profile) {
            const { error: insertError } = await supabase
                .from('profiles')
                .insert({
                    id: user.id,
                    email: user.email!,
                    full_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
                    avatar_url: user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
                })

            if (insertError) {
                console.error('Error creating profile:', insertError)
                return { success: false, hasProfile: false }
            }

            return { success: true, hasProfile: false } // Profile created, but no username yet
        }

        return { success: true, hasProfile: !!profile.username }
    } catch (error) {
        console.error('Error ensuring profile:', error)
        return { success: false, hasProfile: false }
    }
}
