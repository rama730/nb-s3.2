/**
 * Centralized Profile Service
 * Single source of truth for all profile operations
 * Handles caching, JWT sync, and avatar management
 */

import { createClient } from '@/lib/supabase/server'
import { isEmailVerified } from '@/lib/auth/email-verification'
import { db } from '@/lib/db'
import { profileSecurityStates, profiles } from '@/lib/db/schema'
import type { Profile } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { normalizeNotificationPreferences } from '@/lib/notifications/preferences'
import { buildViewerScopedProfileView, type PrivateProfileSecurityState, type PublicProfileView, type ViewerScopedProfileView } from '@/lib/privacy/profile-views'
import { resolvePrivacyRelationship } from '@/lib/privacy/resolver'
import { parseStoredRecoveryCodes, type StoredRecoveryCode } from '@/lib/security/recovery-codes'
import { and, eq, isNull } from 'drizzle-orm'

// Per-instance in-memory profile cache (shared across requests on one instance).
// In multi-instance deployments this may serve stale data until TTL expires.
export type StandardProfile = Omit<Profile, 'workspaceLayout'> & {
    hasRecoveryCodes: boolean
}

export type ProtectedRecoveryCodes = PrivateProfileSecurityState & {
    securityRecoveryCodes: StoredRecoveryCode[]
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
export async function getSelfProfile(userId: string): Promise<StandardProfile | null> {
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

    let data: Pick<Profile,
        | 'id'
        | 'email'
        | 'username'
        | 'fullName'
        | 'avatarUrl'
        | 'bannerUrl'
        | 'bio'
        | 'headline'
        | 'location'
        | 'website'
        | 'skills'
        | 'interests'
        | 'socialLinks'
        | 'visibility'
        | 'connectionPrivacy'
        | 'notificationPreferences'
        | 'experience'
        | 'education'
        | 'openTo'
        | 'availabilityStatus'
        | 'messagePrivacy'
        | 'experienceLevel'
        | 'hoursPerWeek'
        | 'genderIdentity'
        | 'pronouns'
        | 'connectionsCount'
        | 'projectsCount'
        | 'followersCount'
        | 'workspaceInboxCount'
        | 'workspaceDueTodayCount'
        | 'workspaceOverdueCount'
        | 'workspaceInProgressCount'
        | 'lastActiveAt'
        | 'deletedAt'
        | 'createdAt'
        | 'updatedAt'
    > | undefined

    try {
        data = await db.query.profiles.findFirst({
            where: and(eq(profiles.id, userId), isNull(profiles.deletedAt)),
            columns: {
                id: true,
                email: true,
                username: true,
                fullName: true,
                avatarUrl: true,
                bannerUrl: true,
                bio: true,
                headline: true,
                location: true,
                website: true,
                skills: true,
                interests: true,
                socialLinks: true,
                visibility: true,
                connectionPrivacy: true,
                notificationPreferences: true,
                experience: true,
                education: true,
                openTo: true,
                availabilityStatus: true,
                messagePrivacy: true,
                experienceLevel: true,
                hoursPerWeek: true,
                genderIdentity: true,
                pronouns: true,
                connectionsCount: true,
                projectsCount: true,
                followersCount: true,
                workspaceInboxCount: true,
                workspaceDueTodayCount: true,
                workspaceOverdueCount: true,
                workspaceInProgressCount: true,
                lastActiveAt: true,
                deletedAt: true,
                createdAt: true,
                updatedAt: true,
            },
        })
    } catch (error) {
        logger.error('profile-service.getProfile.failed', {
            userId,
            error: error instanceof Error ? error.message : String(error),
        })
        return null
    }

    if (!data) {
        return null
    }

    // Map snake_case to camelCase for type safety.
    // Recovery-code hashes stay out of the standard profile surface and must be loaded
    // through getProtectedRecoveryCodes() from an explicitly authorized security path.
    const profile: StandardProfile = {
        id: data.id,
        email: data.email,
        username: data.username,
        fullName: data.fullName,
        avatarUrl: data.avatarUrl,
        bannerUrl: data.bannerUrl,
        bio: data.bio,
        headline: data.headline,
        location: data.location,
        website: data.website,
        skills: data.skills || [],
        interests: data.interests || [],
        socialLinks: data.socialLinks || {},
        visibility: data.visibility || 'public',
        connectionPrivacy: data.connectionPrivacy || 'everyone',
        notificationPreferences: normalizeNotificationPreferences(data.notificationPreferences),
        // New fields
        experience: data.experience || [],
        education: data.education || [],
        openTo: data.openTo || [],
        availabilityStatus: data.availabilityStatus || 'available',
        messagePrivacy: data.messagePrivacy || 'connections',
        experienceLevel: data.experienceLevel || null,
        hoursPerWeek: data.hoursPerWeek || null,
        genderIdentity: data.genderIdentity || null,
        pronouns: data.pronouns || null,
        connectionsCount: data.connectionsCount ?? 0,
        projectsCount: data.projectsCount ?? 0,
        followersCount: data.followersCount ?? 0,
        workspaceInboxCount: data.workspaceInboxCount ?? 0,
        workspaceDueTodayCount: data.workspaceDueTodayCount ?? 0,
        workspaceOverdueCount: data.workspaceOverdueCount ?? 0,
        workspaceInProgressCount: data.workspaceInProgressCount ?? 0,
        hasRecoveryCodes: false,
        lastActiveAt: data.lastActiveAt ?? null,
        deletedAt: data.deletedAt ?? null,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
    }

    if (PROFILE_IN_MEMORY_CACHE_ENABLED) {
        setCachedProfile(userId, profile, now)
    }

    return profile
}

export async function getViewerScopedProfile(
    viewerId: string | null,
    subjectUserId: string,
): Promise<ViewerScopedProfileView | PublicProfileView | null> {
    const profile = await getSelfProfile(subjectUserId)
    if (!profile) return null

    const isOwner = !!viewerId && viewerId === subjectUserId
    const relationship = isOwner ? null : await resolvePrivacyRelationship(viewerId, subjectUserId)
    return buildViewerScopedProfileView({
        profile,
        relationship,
        isOwner,
    })
}

export const getProfile = getSelfProfile

export async function getProtectedRecoveryCodes(
    userId: string,
    options: { authorized: boolean },
): Promise<ProtectedRecoveryCodes | null> {
    if (!options.authorized) {
        throw new Error('Recovery code access is not authorized')
    }

    try {
        const state = await db.query.profileSecurityStates.findFirst({
            columns: {
                securityRecoveryCodes: true,
                recoveryCodesGeneratedAt: true,
            },
            where: eq(profileSecurityStates.userId, userId),
        })

        if (!state) {
            return {
                securityRecoveryCodes: [],
                recoveryCodesGeneratedAt: null,
                hasRecoveryCodes: false,
            }
        }

        const securityRecoveryCodes = parseStoredRecoveryCodes(state.securityRecoveryCodes)
        return {
            // Stored recovery codes are hashed + salted entries only, never plaintext values.
            securityRecoveryCodes,
            recoveryCodesGeneratedAt: state.recoveryCodesGeneratedAt ?? null,
            hasRecoveryCodes: securityRecoveryCodes.length > 0 || !!state.recoveryCodesGeneratedAt,
        }
    } catch (error) {
        logger.error('profile-service.getProtectedRecoveryCodes.failed', {
            userId,
            error: error instanceof Error ? error.message : String(error),
        })
        return null
    }
}

/**
 * Update profile with automatic cache invalidation
 */
export async function updateProfile(
    userId: string,
    data: ProfileUpdateData
): Promise<{ success: boolean; error?: string; profile?: StandardProfile }> {
    const updateData: Partial<Profile> = {
        updatedAt: new Date(),
    }

    if (data.username !== undefined) updateData.username = data.username
    if (data.fullName !== undefined) updateData.fullName = data.fullName
    if (data.avatarUrl !== undefined) updateData.avatarUrl = data.avatarUrl
    if (data.bannerUrl !== undefined) updateData.bannerUrl = data.bannerUrl
    if (data.headline !== undefined) updateData.headline = data.headline
    if (data.bio !== undefined) updateData.bio = data.bio
    if (data.location !== undefined) updateData.location = data.location
    if (data.website !== undefined) updateData.website = data.website
    if (data.skills !== undefined) updateData.skills = data.skills
    if (data.interests !== undefined) updateData.interests = data.interests

    if (data.socialLinks !== undefined) updateData.socialLinks = data.socialLinks
    if (data.visibility !== undefined) updateData.visibility = data.visibility

    // New fields
    if (data.experience !== undefined) updateData.experience = data.experience
    if (data.education !== undefined) updateData.education = data.education
    if (data.openTo !== undefined) updateData.openTo = data.openTo
    if (data.availabilityStatus !== undefined) updateData.availabilityStatus = data.availabilityStatus
    if (data.messagePrivacy !== undefined) updateData.messagePrivacy = data.messagePrivacy
    if (data.experienceLevel !== undefined) updateData.experienceLevel = data.experienceLevel
    if (data.hoursPerWeek !== undefined) updateData.hoursPerWeek = data.hoursPerWeek
    if (data.genderIdentity !== undefined) updateData.genderIdentity = data.genderIdentity
    if (data.pronouns !== undefined) updateData.pronouns = data.pronouns

    try {
        await db
            .update(profiles)
            .set(updateData)
            .where(eq(profiles.id, userId))
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        }
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
    try {
        await db
            .insert(profiles)
            .values({
                id: userId,
                email,
                fullName: metadata?.fullName || null,
                avatarUrl: metadata?.avatarUrl || null,
            })
            .onConflictDoNothing()
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        }
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
