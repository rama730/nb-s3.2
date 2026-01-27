/**
 * Centralized Profile Service
 * Single source of truth for all profile operations
 * Handles caching, JWT sync, and avatar management
 */

import { createClient } from '@/lib/supabase/server'
import type { Profile } from '@/lib/db/schema'

// Profile cache (server-side, per-request)
const profileCache = new Map<string, { profile: Profile; timestamp: number }>()
const CACHE_TTL = 60 * 1000 // 1 minute

export interface ProfileUpdateData {
    username?: string
    fullName?: string
    avatarUrl?: string
    bannerUrl?: string
    headline?: string
    bio?: string
    location?: string
    website?: string
    skills?: string[]
    interests?: string[]
    socialLinks?: Record<string, string>
    visibility?: 'public' | 'connections' | 'private'
    // New fields
    experience?: any[]
    education?: any[]
    openTo?: string[]
    availabilityStatus?: 'available' | 'busy' | 'offline' | 'focusing'
    messagePrivacy?: 'everyone' | 'connections'
}

/**
 * Get profile by user ID with caching
 */
export async function getProfile(userId: string): Promise<Profile | null> {
    // Check cache first
    const cached = profileCache.get(userId)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.profile
    }

    const supabase = await createClient()

    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle() // Use maybeSingle to return null instead of erroring when no profile exists

    if (error || !data) {
        return null
    }

    // Map snake_case to camelCase for type safety
    const profile: Profile = {
        id: data.id,
        email: data.email,
        username: data.username,
        fullName: data.full_name,
        avatarUrl: data.avatar_url,
        bannerUrl: data.banner_url,
        bio: data.bio,
        headline: data.headline,
        location: data.location,
        website: data.website,
        skills: data.skills || [],
        interests: data.interests || [],
        socialLinks: data.social_links || {},
        visibility: data.visibility || 'public',
        // New fields
        experience: data.experience || [],
        education: data.education || [],
        openTo: data.open_to || [],
        availabilityStatus: data.availability_status || 'available',
        messagePrivacy: data.message_privacy || 'connections',
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at),
    }

    // Cache the result
    profileCache.set(userId, { profile, timestamp: Date.now() })

    return profile
}

/**
 * Update profile with automatic cache invalidation
 */
export async function updateProfile(
    userId: string,
    data: ProfileUpdateData
): Promise<{ success: boolean; error?: string; profile?: Profile }> {
    const supabase = await createClient()

    // Build update object with snake_case keys
    const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
    }

    if (data.username !== undefined) updateData.username = data.username
    if (data.fullName !== undefined) updateData.full_name = data.fullName
    if (data.avatarUrl !== undefined) updateData.avatar_url = data.avatarUrl
    if (data.bannerUrl !== undefined) updateData.banner_url = data.bannerUrl
    if (data.headline !== undefined) updateData.headline = data.headline
    if (data.bio !== undefined) updateData.bio = data.bio
    if (data.location !== undefined) updateData.location = data.location
    if (data.website !== undefined) updateData.website = data.website
    if (data.skills !== undefined) updateData.skills = data.skills
    if (data.interests !== undefined) updateData.interests = data.interests

    if (data.socialLinks !== undefined) updateData.social_links = data.socialLinks
    if (data.visibility !== undefined) updateData.visibility = data.visibility

    // New fields
    if (data.experience !== undefined) updateData.experience = data.experience
    if (data.education !== undefined) updateData.education = data.education
    if (data.openTo !== undefined) updateData.open_to = data.openTo
    if (data.availabilityStatus !== undefined) updateData.availability_status = data.availabilityStatus
    if (data.messagePrivacy !== undefined) updateData.message_privacy = data.messagePrivacy

    const { error } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', userId)

    if (error) {
        return { success: false, error: error.message }
    }

    // Invalidate cache
    profileCache.delete(userId)

    // If username was updated, sync to JWT claims
    if (data.username) {
        await syncProfileToJWT(userId, data.username)
    }

    // Fetch fresh profile
    const profile = await getProfile(userId)

    return { success: true, profile: profile || undefined }
}

/**
 * Create profile for new user
 */
export async function createProfile(
    userId: string,
    email: string,
    metadata?: { fullName?: string; avatarUrl?: string }
): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient()

    const { error } = await supabase
        .from('profiles')
        .insert({
            id: userId,
            email,
            full_name: metadata?.fullName || null,
            avatar_url: metadata?.avatarUrl || null,
        })

    if (error) {
        // Ignore duplicate key errors (profile already exists)
        if (error.code === '23505') {
            return { success: true }
        }
        return { success: false, error: error.message }
    }

    return { success: true }
}

/**
 * Sync profile data to JWT custom claims
 * This eliminates the need for DB calls in middleware
 */
export async function syncProfileToJWT(
    userId: string,
    username: string
): Promise<void> {
    // Note: This requires service role key for admin operations
    // For now, we store in user metadata which is accessible in session
    const supabase = await createClient()

    await supabase.auth.updateUser({
        data: {
            username,
            onboarded: true,
        }
    })
}

/**
 * Check if user has completed onboarding (from JWT, no DB call)
 */
export function isOnboarded(user: { user_metadata?: Record<string, unknown> }): boolean {
    return !!user.user_metadata?.onboarded && !!user.user_metadata?.username
}

/**
 * Get username from JWT (no DB call)
 */
export function getUsernameFromJWT(user: { user_metadata?: Record<string, unknown> }): string | null {
    return (user.user_metadata?.username as string) || null
}

/**
 * Clear profile cache (useful after logout)
 */
export function clearProfileCache(userId?: string): void {
    if (userId) {
        profileCache.delete(userId)
    } else {
        profileCache.clear()
    }
}
