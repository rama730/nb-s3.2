'use server'

import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { profiles } from '@/lib/db/schema'
import { eq, and, ne } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

// Validation Schema
const profileSchema = z.object({
    username: z.string().min(3).max(20).regex(/^[a-z0-9_]+$/, 'Only lowercase letters, numbers, and underscores allowed').optional(),
    fullName: z.string().max(100).optional(),
    headline: z.string().max(100).optional(),
    bio: z.string().max(5000).optional(),
    location: z.string().max(100).optional(),
    website: z.string().url().or(z.literal('')).optional(),
    avatarUrl: z.string().optional(),
    bannerUrl: z.string().optional(),
    skills: z.array(z.string()).optional(),
    interests: z.array(z.string()).optional(),
    socialLinks: z.record(z.string(), z.string()).optional(),
    visibility: z.enum(['public', 'connections', 'private']).optional(),
    // Updated Schema Fields
    availabilityStatus: z.enum(['available', 'busy', 'offline', 'focusing']).optional(),
    openTo: z.array(z.string()).optional(),
    experience: z.array(z.any()).optional(),
    education: z.array(z.any()).optional(),
})

export type UpdateProfileInput = z.infer<typeof profileSchema>

export async function updateProfileAction(data: UpdateProfileInput) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return { success: false, error: 'Unauthorized' }
        }

        // Validate Input
        const result = profileSchema.safeParse(data)
        if (!result.success) {
            return { success: false, error: result.error.issues[0].message }
        }
        const validData = result.data

        // Check Username Uniqueness if changed
        if (validData.username) {
            const existing = await db.query.profiles.findFirst({
                columns: { id: true },
                where: and(
                    eq(profiles.username, validData.username),
                    ne(profiles.id, user.id)
                )
            })

            if (existing) {
                return { success: false, error: 'Username is already taken' }
            }
        }

        // Prepare Update Object
        const updateData: any = {
            updatedAt: new Date(),
        }

        // Explicitly map fields to ensure type safety and schema alignment
        if (validData.username !== undefined) updateData.username = validData.username
        if (validData.fullName !== undefined) updateData.fullName = validData.fullName
        if (validData.headline !== undefined) updateData.headline = validData.headline
        if (validData.bio !== undefined) updateData.bio = validData.bio
        if (validData.location !== undefined) updateData.location = validData.location
        if (validData.website !== undefined) updateData.website = validData.website
        if (validData.avatarUrl !== undefined) updateData.avatarUrl = validData.avatarUrl
        if (validData.bannerUrl !== undefined) updateData.bannerUrl = validData.bannerUrl
        if (validData.skills !== undefined) updateData.skills = validData.skills
        if (validData.interests !== undefined) updateData.interests = validData.interests
        if (validData.socialLinks !== undefined) updateData.socialLinks = validData.socialLinks
        if (validData.visibility !== undefined) updateData.visibility = validData.visibility

        if (validData.availabilityStatus !== undefined) updateData.availabilityStatus = validData.availabilityStatus
        if (validData.openTo !== undefined) updateData.openTo = validData.openTo
        if (validData.experience !== undefined) updateData.experience = validData.experience
        if (validData.education !== undefined) updateData.education = validData.education

        await db.update(profiles)
            .set(updateData)
            .where(eq(profiles.id, user.id))

        // Update Auth Metadata if username/avatar/name changed
        if (validData.username || validData.fullName || validData.avatarUrl) {
            await supabase.auth.updateUser({
                data: {
                    username: validData.username,
                    full_name: validData.fullName,
                    avatar_url: validData.avatarUrl
                }
            })
        }

        revalidatePath('/profile')
        // We revalidate both potential paths to be safe
        if (validData.username) revalidatePath(`/${validData.username}`)

        return { success: true }
    } catch (error) {
        console.error('Error updating profile:', error)
        return { success: false, error: 'Failed to update profile' }
    }
}
