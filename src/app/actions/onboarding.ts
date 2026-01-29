'use server'

import { createClient } from '@/lib/supabase/server'

/**
 * Complete onboarding - save profile with username
 * Syncs username to JWT claims for fast middleware checks
 */
export async function completeOnboarding(data: {
    username: string
    fullName: string
    avatarUrl?: string
    headline?: string
    bio?: string
    location?: string
    website?: string
    skills?: string[]
    interests?: string[]
    visibility?: 'public' | 'connections' | 'private'
}): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient()

        // Validate username format first (synchronous)
        if (!data.username || data.username.length < 3) {
            return { success: false, error: 'Username must be at least 3 characters' }
        }

        if (data.username.length > 20) {
            return { success: false, error: 'Username must be 20 characters or less' }
        }

        if (!/^[a-z0-9_]+$/.test(data.username)) {
            return { success: false, error: 'Only lowercase letters, numbers, and underscores allowed' }
        }

        // Parallelize Auth Check and Database Availability Check ("Fast Showing")
        const [authResult, usernameResult] = await Promise.all([
            supabase.auth.getUser(),
            supabase
                .from('profiles')
                .select('id')
                .eq('username', data.username)
                .maybeSingle()
        ]);

        const { data: { user }, error: authError } = authResult;

        if (authError || !user) {
            console.error('Auth error:', authError)
            return { success: false, error: 'Session expired. Please login again.' }
        }

        // Check availability result
        const { data: existingUser } = usernameResult;

        // Ensure we don't block own user (though upsert handles it by ID, this check prevents claiming ANOTHER user's username)
        // Note: existingUser finding might be OURSELVES if we already have a profile with this username? 
        // Logic says: .neq('id', user.id) is hard because we don't have user.id in the parallel call yet.
        // Optimization: We can check ID match after we get both.

        if (existingUser && existingUser.id !== user.id) {
            return { success: false, error: 'Username is already taken' }
        }

        // Update profile using upsert
        const { error: profileError } = await supabase
            .from('profiles')
            .upsert({
                id: user.id,
                email: user.email!,
                username: data.username,
                full_name: data.fullName,
                avatar_url: data.avatarUrl || user.user_metadata?.avatar_url,
                headline: data.headline || null,
                bio: data.bio || null,
                location: data.location || null,
                website: data.website || null,
                skills: data.skills || [],
                interests: data.interests || [],
                visibility: data.visibility || 'public',
                updated_at: new Date().toISOString(),
            })

        if (profileError) {
            console.error('Error saving profile:', profileError)
            if (profileError.code === 'PGRST205') {
                return { success: false, error: 'Database not set up. Please run npm run db:setup' }
            }
            if (profileError.code === '23505') {
                return { success: false, error: 'Username is already taken' }
            }
            return { success: false, error: profileError.message }
        }

        // Sync username to JWT claims for fast middleware checks
        const { error: updateError } = await supabase.auth.updateUser({
            data: {
                username: data.username,
                onboarded: true,
                full_name: data.fullName,
                avatar_url: data.avatarUrl || user.user_metadata?.avatar_url,
            }
        })

        if (updateError) {
            console.error('Error syncing to JWT:', updateError)
            // Don't fail - profile is saved
        }

        return { success: true }
    } catch (error) {
        console.error('Error completing onboarding:', error)
        return { success: false, error: 'An unexpected error occurred' }
    }
}

/**
 * Check if username is available
 */
export async function checkUsernameAvailability(username: string): Promise<{
    available: boolean
    message: string
}> {
    // Format validation first
    if (!username || username.length < 3) {
        return { available: false, message: 'Username must be at least 3 characters' }
    }

    if (username.length > 20) {
        return { available: false, message: 'Username must be 20 characters or less' }
    }

    if (!/^[a-z0-9_]+$/.test(username)) {
        return { available: false, message: 'Only lowercase letters, numbers, and underscores' }
    }

    const reserved = ['admin', 'edge', 'api', 'www', 'mail', 'support', 'help', 'settings', 'profile', 'login', 'signup', 'auth', 'onboarding']
    if (reserved.includes(username)) {
        return { available: false, message: 'This username is reserved' }
    }

    try {
        const supabase = await createClient()

        const { data, error } = await supabase
            .from('profiles')
            .select('id')
            .eq('username', username)
            .limit(1)

        if (error) {
            console.error('Error checking username:', error)
            return { available: false, message: 'Error checking availability' }
        }

        if (data && data.length > 0) {
            return { available: false, message: 'Username is already taken' }
        }

        return { available: true, message: 'Username is available!' }
    } catch (error) {
        console.error('Error checking username:', error)
        return { available: false, message: 'Error checking availability' }
    }
}
