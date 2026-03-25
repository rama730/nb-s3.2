/**
 * Centralized Profile Service
 * Single source of truth for all profile operations
 * Handles caching, JWT sync, and avatar management
 */

import { createClient } from '@/lib/supabase/server'
import { isEmailVerified } from '@/lib/auth/email-verification'
import type { Profile } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { parseStoredRecoveryCodes, type StoredRecoveryCode } from '@/lib/security/recovery-codes'

// Per-instance in-memory profile cache (shared across requests on one instance).
// In multi-instance deployments this may serve stale data until TTL expires.
export type StandardProfile = Omit<Profile, 'securityRecoveryCodes' | 'recoveryCodesGeneratedAt'> & {
    hasRecoveryCodes: boolean
}

export type ProtectedRecoveryCodes = {
    securityRecoveryCodes: StoredRecoveryCode[]
    recoveryCodesGeneratedAt: Date | null
    hasRecoveryCodes: boolean
}

const profileCache = new Map<string, { profile: StandardProfile; timestamp: number }>()
const CACHE_TTL = 60 * 1000 // 1 minute
const PROFILE_CACHE_MAX_ENTRIES = 1000
const PROFILE_IN_MEMORY_CACHE_ENABLED =
    process.env.NODE_ENV !== 'production' ||
    process.env.PROFILE_IN_MEMORY_CACHE_ENABLED === 'true' ||
    process.env.PROFILE_CACHE_LOCAL_ENABLED === 'true'

function pruneProfileCache(now = Date.now()) {
    for (const [key, entry] of profileCache.entries()) {
        if (now - entry.timestamp >= CACHE_TTL) {
            profileCache.delete(key)
        }
    }

    while (profileCache.size >= PROFILE_CACHE_MAX_ENTRIES) {
        const oldestKey = profileCache.keys().next().value as string | undefined
        if (!oldestKey) break
        profileCache.delete(oldestKey)
    }
}

function setCachedProfile(userId: string, profile: StandardProfile, now = Date.now()) {
    profileCache.delete(userId)
    pruneProfileCache(now)
    profileCache.set(userId, { profile, timestamp: now })
}

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
    experienceLevel?: 'student' | 'junior' | 'mid' | 'senior' | 'lead' | 'founder' | null
    hoursPerWeek?: 'lt_5' | 'h_5_10' | 'h_10_20' | 'h_20_40' | 'h_40_plus' | null
    genderIdentity?: 'male' | 'female' | 'non_binary' | 'prefer_not_to_say' | 'other' | null
    pronouns?: string | null
}

/**
 * Get profile by user ID with caching
 */
export async function getProfile(userId: string): Promise<StandardProfile | null> {
    // Check per-instance in-memory cache first.
    const now = Date.now()
    if (PROFILE_IN_MEMORY_CACHE_ENABLED) {
        const cached = profileCache.get(userId)
        if (cached && now - cached.timestamp < CACHE_TTL) {
            profileCache.delete(userId)
            profileCache.set(userId, cached)
            return cached.profile
        }
        if (cached) {
            profileCache.delete(userId)
        }
    }

    const supabase = await createClient()

    const { data, error } = await supabase
        .from('profiles')
        .select(`
            id,
            email,
            username,
            full_name,
            avatar_url,
            banner_url,
            bio,
            headline,
            location,
            website,
            skills,
            interests,
            social_links,
            visibility,
            connection_privacy,
            experience,
            education,
            open_to,
            availability_status,
            message_privacy,
            experience_level,
            hours_per_week,
            gender_identity,
            pronouns,
            workspace_layout,
            connections_count,
            projects_count,
            followers_count,
            workspace_inbox_count,
            workspace_due_today_count,
            workspace_overdue_count,
            workspace_in_progress_count,
            security_recovery_codes,
            recovery_codes_generated_at,
            deleted_at,
            created_at,
            updated_at
        `)
        .eq('id', userId)
        .maybeSingle() // Use maybeSingle to return null instead of erroring when no profile exists

    if (error) {
        logger.error('profile-service.getProfile.failed', {
            userId,
            error: error.message,
        })
        return null
    }

    if (!data) {
        return null
    }

    const hasRecoveryCodes =
        (Array.isArray(data.security_recovery_codes) && data.security_recovery_codes.length > 0)
        || !!data.recovery_codes_generated_at

    // Map snake_case to camelCase for type safety.
    // Recovery-code hashes stay out of the standard profile surface and must be loaded
    // through getProtectedRecoveryCodes() from an explicitly authorized security path.
    const profile: StandardProfile = {
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
        connectionPrivacy: data.connection_privacy || 'everyone',
        // New fields
        experience: data.experience || [],
        education: data.education || [],
        openTo: data.open_to || [],
        availabilityStatus: data.availability_status || 'available',
        messagePrivacy: data.message_privacy || 'connections',
        experienceLevel: data.experience_level || null,
        hoursPerWeek: data.hours_per_week || null,
        genderIdentity: data.gender_identity || null,
        pronouns: data.pronouns || null,
        workspaceLayout: data.workspace_layout ?? null,
        connectionsCount: data.connections_count ?? 0,
        projectsCount: data.projects_count ?? 0,
        followersCount: data.followers_count ?? 0,
        workspaceInboxCount: data.workspace_inbox_count ?? 0,
        workspaceDueTodayCount: data.workspace_due_today_count ?? 0,
        workspaceOverdueCount: data.workspace_overdue_count ?? 0,
        workspaceInProgressCount: data.workspace_in_progress_count ?? 0,
        hasRecoveryCodes,
        deletedAt: data.deleted_at ?? null,
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at),
    }

    if (PROFILE_IN_MEMORY_CACHE_ENABLED) {
        setCachedProfile(userId, profile, now)
    }

    return profile
}

export async function getProtectedRecoveryCodes(
    userId: string,
    options: { authorized: boolean },
): Promise<ProtectedRecoveryCodes | null> {
    if (!options.authorized) {
        throw new Error('Recovery code access is not authorized')
    }

    const supabase = await createClient()
    const { data, error } = await supabase
        .from('profiles')
        .select('security_recovery_codes, recovery_codes_generated_at')
        .eq('id', userId)
        .maybeSingle()

    if (error) {
        logger.error('profile-service.getProtectedRecoveryCodes.failed', {
            userId,
            error: error.message,
        })
        return null
    }

    if (!data) {
        return null
    }

    const securityRecoveryCodes = parseStoredRecoveryCodes(data.security_recovery_codes)
    return {
        // Stored recovery codes are hashed + salted entries only, never plaintext values.
        securityRecoveryCodes,
        recoveryCodesGeneratedAt: data.recovery_codes_generated_at
            ? new Date(data.recovery_codes_generated_at)
            : null,
        hasRecoveryCodes: securityRecoveryCodes.length > 0 || !!data.recovery_codes_generated_at,
    }
}

/**
 * Update profile with automatic cache invalidation
 */
export async function updateProfile(
    userId: string,
    data: ProfileUpdateData
): Promise<{ success: boolean; error?: string; profile?: StandardProfile }> {
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
    if (data.experienceLevel !== undefined) updateData.experience_level = data.experienceLevel
    if (data.hoursPerWeek !== undefined) updateData.hours_per_week = data.hoursPerWeek
    if (data.genderIdentity !== undefined) updateData.gender_identity = data.genderIdentity
    if (data.pronouns !== undefined) updateData.pronouns = data.pronouns

    const { error } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', userId)

    if (error) {
        return { success: false, error: error.message }
    }

    if (PROFILE_IN_MEMORY_CACHE_ENABLED) {
        profileCache.delete(userId)
    }

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

    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError || !authData.user) {
        console.error('Failed to get user for JWT sync', {
            userId,
            error: authError?.message ?? 'missing_user',
        })
        return
    }

    const user = authData.user

    await supabase.auth.updateUser({
        data: {
            username,
            onboarded: true,
            email_verified: isEmailVerified(user),
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
