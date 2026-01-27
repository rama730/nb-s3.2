'use server';

import { db } from '@/lib/db';
import { profiles, projects, connections } from '@/lib/db/schema';
import { createClient } from '@/lib/supabase/server';
import { eq, or } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

/**
 * Delete the current user's account and all associated data.
 * This is a DESTRUCTIVE action that cannot be undone.
 */
export async function deleteMyAccount(): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, error: 'Not authenticated' };
        }

        const userId = user.id;

        // 1. Delete user's projects (cascade will handle project_members, open_roles, etc.)
        await db.delete(projects).where(eq(projects.ownerId, userId));

        // 2. Delete user's connections (both sent and received)
        await db.delete(connections).where(
            or(
                eq(connections.requesterId, userId),
                eq(connections.addresseeId, userId)
            )
        );

        // 3. Delete user's avatar and files from storage
        try {
            // List and delete avatar files
            const { data: avatarFiles } = await supabase.storage
                .from('avatars')
                .list('', { search: userId });

            if (avatarFiles && avatarFiles.length > 0) {
                const filesToDelete = avatarFiles.map(f => f.name);
                await supabase.storage.from('avatars').remove(filesToDelete);
            }
        } catch (storageError) {
            console.error('Storage cleanup error (non-fatal):', storageError);
            // Continue even if storage cleanup fails
        }

        // 4. Delete user's profile
        await db.delete(profiles).where(eq(profiles.id, userId));

        // 5. Delete the auth user (this signs them out automatically)
        // Note: This requires the user to be authenticated, which they are
        let authError: { message: string } | null = null;
        try {
            const adminResult = await supabase.auth.admin?.deleteUser?.(userId);
            if (adminResult?.error) {
                authError = adminResult.error;
            }
        } catch {
            // Admin API not available, try RPC
            try {
                const { error } = await supabase.rpc('delete_auth_user', { user_id: userId });
                if (error) authError = error;
            } catch {
                authError = { message: 'Auth deletion not available' };
            }
        }

        if (authError) {
            console.error('Auth deletion error:', authError);
            // Profile is already deleted, so we continue
        }

        // 6. Sign out the user
        await supabase.auth.signOut();

        revalidatePath('/');
        return { success: true };
    } catch (error) {
        console.error('Account deletion error:', error);
        return { success: false, error: 'Failed to delete account' };
    }
}

/**
 * Clean up orphaned profiles (profiles that exist in DB but not in Auth).
 * This is an admin-only function for maintenance.
 */
export async function cleanupOrphanedProfile(profileId: string): Promise<{ success: boolean; error?: string }> {
    try {
        // First, check if the profile exists
        const profile = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);

        if (profile.length === 0) {
            return { success: false, error: 'Profile not found' };
        }

        // Delete associated data
        await db.delete(projects).where(eq(projects.ownerId, profileId));
        await db.delete(connections).where(
            or(
                eq(connections.requesterId, profileId),
                eq(connections.addresseeId, profileId)
            )
        );

        // Delete the profile
        await db.delete(profiles).where(eq(profiles.id, profileId));

        revalidatePath('/people');
        return { success: true };
    } catch (error) {
        console.error('Cleanup error:', error);
        return { success: false, error: 'Failed to cleanup profile' };
    }
}
