'use server'

import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { profiles, projects } from '@/lib/db/schema'
import { eq, and, ne, desc } from 'drizzle-orm'
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

export async function updateBioAction(bio: string) {
    return updateProfileAction({ bio });
}

export async function getProfileBasic(userId: string) {
    if (!userId) return null;
    try {
        const [profile] = await db
            .select({
                id: profiles.id,
                fullName: profiles.fullName,
                username: profiles.username,
                avatarUrl: profiles.avatarUrl,
            })
            .from(profiles)
            .where(eq(profiles.id, userId))
            .limit(1);

        return profile || null;
    } catch (error) {
        console.error('Error fetching profile basic:', error);
        return null;
    }
}

export async function getProfileProjectsAction(userId: string) {
    if (!userId) return [];
    try {
        const userProjects = await db
            .select({
                id: projects.id,
                slug: projects.slug,
                title: projects.title,
                description: projects.description,
                shortDescription: projects.shortDescription,
                coverImage: projects.coverImage,
                updatedAt: projects.updatedAt,
            })
            .from(projects)
            .where(eq(projects.ownerId, userId))
            .orderBy(desc(projects.updatedAt), desc(projects.createdAt))
            .limit(12);

        return userProjects.map((project) => ({
            ...project,
            image: project.coverImage || null,
            url: project.slug ? `/projects/${project.slug}` : `/projects/${project.id}`,
        }));
    } catch (error) {
        console.error('Error fetching profile projects:', error);
        return [];
    }
}

export async function getProfileStatsAction(userId: string) {
    if (!userId) return { connectionsCount: 0, projectsCount: 0, followersCount: 0 };
    try {
        const [profileStats] = await db
            .select({
                connectionsCount: profiles.connectionsCount,
                projectsCount: profiles.projectsCount,
                followersCount: profiles.followersCount,
            })
            .from(profiles)
            .where(eq(profiles.id, userId))
            .limit(1);

        if (profileStats) {
            return {
                connectionsCount: profileStats.connectionsCount || 0,
                projectsCount: profileStats.projectsCount || 0,
                followersCount: profileStats.followersCount || 0,
            };
        }

        return {
            connectionsCount: 0,
            projectsCount: 0,
            followersCount: 0
        };
    } catch (error) {
        console.error('Error fetching profile stats:', error);
        return { connectionsCount: 0, projectsCount: 0, followersCount: 0 };
    }
}
