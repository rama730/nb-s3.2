'use server';

import { db, readDb } from "@/lib/db";
import { 
    profiles, 
    projects, 
    connections, 
    projectMembers, 
    messages, 
    conversationParticipants,
    messageAttachments,
    collections,
    accountDeletions,
    projectNodes,
    profileAuditEvents,
    dmPairs,
    projectFollows
} from "@/lib/db/schema";
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from '@/lib/security/admin';
import { eq, or, and, inArray, isNull, sql, desc, ne } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { queueCounterRefreshBestEffort } from '@/lib/workspace/counter-buffer';
import { randomBytes } from 'crypto';

const UUID_RE =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const ACCOUNT_DELETE_CONFIRM_TEXT = 'DELETE';
const GRACE_PERIOD_DAYS = 30;
const CONFIRMATION_TOKEN_EXPIRY_HOURS = 1;

// ============================================================================
// SCHEDULE ACCOUNT DELETION (Soft-Delete with Grace Period)
// ============================================================================

/**
 * Schedule the current user's account for deletion with a 30-day grace period.
 * The account is soft-deleted immediately (hidden from pub), and hard-deleted
 * by a background cron job after the grace period expires.
 */
export async function scheduleAccountDeletion(
    confirmationText?: string,
    reason?: string,
): Promise<{ success: boolean; error?: string; deletionId?: string; hardDeleteAt?: string }> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, error: 'Not authenticated' };
        }

        const normalizedConfirmation = (confirmationText || '').trim().toUpperCase();
        if (normalizedConfirmation !== ACCOUNT_DELETE_CONFIRM_TEXT) {
            return { success: false, error: 'Confirmation required' };
        }

        const { error: reauthError } = await supabase.auth.reauthenticate();
        if (reauthError) {
            return { success: false, error: 'Please re-authenticate and retry account deletion' };
        }

        const userId = user.id;
        const userEmail = user.email || '';
        const now = new Date();
        const hardDeleteAt = new Date(now.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
        const tokenExpiresAt = new Date(now.getTime() + CONFIRMATION_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);
        const confirmationToken = randomBytes(32).toString('hex');

        // Check for existing pending deletion
        const existingDeletion = await db
            .select({ id: accountDeletions.id })
            .from(accountDeletions)
            .where(
                and(
                    eq(accountDeletions.userId, userId),
                    isNull(accountDeletions.cancelledAt),
                    isNull(accountDeletions.completedAt),
                )
            )
            .limit(1);

        if (existingDeletion.length > 0) {
            return { success: false, error: 'Account deletion is already scheduled' };
        }

        // Efficiency: Gather all necessary IDs in one round of parallel requests or optimized queries
        const [affectedConnectionRows, userOwnedProjects, followedProjectRows] = await Promise.all([
            db
                .select({
                    requesterId: connections.requesterId,
                    addresseeId: connections.addresseeId,
                })
                .from(connections)
                .where(
                    or(
                        eq(connections.requesterId, userId),
                        eq(connections.addresseeId, userId)
                    )
                ),
            db
                .select({ id: projects.id })
                .from(projects)
                .where(eq(projects.ownerId, userId)),
            db
                .select({ projectId: projectFollows.projectId })
                .from(projectFollows)
                .where(eq(projectFollows.userId, userId))
        ]);

        const affectedUserIds = affectedConnectionRows
            .flatMap((row) => [
                row.requesterId === userId ? null : row.requesterId,
                row.addresseeId === userId ? null : row.addresseeId,
            ])
            .filter((id): id is string => id !== null);

        // Run all DB mutations in a single transaction
        const deletionId = await db.transaction(async (tx) => {
            // 1. Soft-delete the profile
            await tx
                .update(profiles)
                .set({
                    deletedAt: now,
                    visibility: 'private',
                    updatedAt: now,
                })
                .where(eq(profiles.id, userId));

            // 2. Create immutable audit record
            const [deletion] = await tx
                .insert(accountDeletions)
                .values({
                    userId,
                    email: userEmail,
                    username: user.user_metadata?.username || null,
                    reason: reason || null,
                    scheduledAt: now,
                    hardDeleteAt,
                    confirmationToken,
                    tokenExpiresAt,
                    cleanupStatus: 'pending',
                    metadata: {
                        userAgent: '',
                        projectCount: userOwnedProjects.length,
                        connectionCount: affectedConnectionRows.length,
                    },
                })
                .returning({ id: accountDeletions.id });

            // 3. Remove user from conversations (so other users see "Deleted User")
            await tx.delete(conversationParticipants).where(
                eq(conversationParticipants.userId, userId)
            );

            // 4. Remove DM pair entries
            await tx.delete(dmPairs).where(
                or(
                    eq(dmPairs.userLow, userId),
                    eq(dmPairs.userHigh, userId),
                )
            );

            // 5. Delete connections (both sent and received)
            await tx.delete(connections).where(
                or(
                    eq(connections.requesterId, userId),
                    eq(connections.addresseeId, userId)
                )
            );

            // 6. Decrement followersCount on projects the user follows
            if (followedProjectRows.length > 0) {
                const followedProjectIds = followedProjectRows.map(r => r.projectId);
                const CHUNK = 100;
                for (let i = 0; i < followedProjectIds.length; i += CHUNK) {
                    const chunk = followedProjectIds.slice(i, i + CHUNK);
                    await tx
                        .update(projects)
                        .set({
                            followersCount: sql`GREATEST(0, ${projects.followersCount} - 1)`,
                        })
                        .where(inArray(projects.id, chunk));
                }
            }

            // 7. Delete project follows by user
            await tx.delete(projectFollows).where(eq(projectFollows.userId, userId));

            // 8. Delete user's collections
            await tx.delete(collections).where(eq(collections.ownerId, userId));

            // 9. Delete user's profile audit events
            await tx.delete(profileAuditEvents).where(eq(profileAuditEvents.userId, userId));

            return deletion.id;
        });

        // Counter refresh (outside transaction — non-critical for consistency)
        try {
            if (affectedUserIds.length > 0) {
                await queueCounterRefreshBestEffort(affectedUserIds);
            }
        } catch (counterErr) {
            console.error('Counter refresh error (non-fatal):', counterErr);
        }

        // Dispatch async S3 cleanup via Inngest
        try {
            const { inngest } = await import('@/inngest/client');
            await inngest.send({
                name: 'account/cleanup',
                data: { userId, deletionId },
            });
        } catch (inngestErr) {
            console.error('Inngest dispatch error (non-fatal):', inngestErr);
        }

        // Sign out the user
        await supabase.auth.signOut();

        revalidatePath('/');
        return {
            success: true,
            deletionId,
            hardDeleteAt: hardDeleteAt.toISOString(),
        };
    } catch (error) {
        console.error('Account deletion scheduling error:', error);
        return { success: false, error: 'Failed to schedule account deletion' };
    }
}

// ============================================================================
// CANCEL ACCOUNT DELETION (Reactivation during Grace Period)
// ============================================================================

/**
 * Cancel a pending account deletion and reactivate the profile.
 */
export async function cancelAccountDeletion(): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, error: 'Not authenticated' };
        }

        const userId = user.id;
        const now = new Date();

        // Find the active deletion record
        const [activeDeletion] = await db
            .select({ id: accountDeletions.id })
            .from(accountDeletions)
            .where(
                and(
                    eq(accountDeletions.userId, userId),
                    isNull(accountDeletions.cancelledAt),
                    isNull(accountDeletions.completedAt),
                )
            )
            .limit(1);

        if (!activeDeletion) {
            return { success: false, error: 'No pending deletion found' };
        }

        await db.transaction(async (tx) => {
            // 1. Cancel the deletion record
            await tx
                .update(accountDeletions)
                .set({ cancelledAt: now })
                .where(eq(accountDeletions.id, activeDeletion.id));

            // 2. Restore the profile
            await tx
                .update(profiles)
                .set({
                    deletedAt: null,
                    visibility: 'public',
                    updatedAt: now,
                })
                .where(eq(profiles.id, userId));
        });

        revalidatePath('/');
        return { success: true };
    } catch (error) {
        console.error('Cancel deletion error:', error);
        return { success: false, error: 'Failed to cancel account deletion' };
    }
}

// ============================================================================
// EXECUTE HARD DELETE (Called by Inngest Cron after Grace Period)
// ============================================================================

/**
 * Permanently delete a user's account and all associated data.
 * This is called by the background cron job after the grace period expires.
 * DESTRUCTIVE — cannot be undone.
 */
export async function executeHardDelete(
    userId: string,
    deletionId: string,
): Promise<{ success: boolean; error?: string }> {
    try {
        if (!UUID_RE.test(userId)) {
            return { success: false, error: 'Invalid user ID' };
        }

        // Verify the deletion record exists and is eligible
        const [deletion] = await db
            .select({ id: accountDeletions.id })
            .from(accountDeletions)
            .where(
                and(
                    eq(accountDeletions.id, deletionId),
                    eq(accountDeletions.userId, userId),
                    isNull(accountDeletions.cancelledAt),
                    isNull(accountDeletions.completedAt),
                )
            )
            .limit(1);

        if (!deletion) {
            return { success: false, error: 'Deletion record not found or already processed' };
        }

        // Run destructive deletes in a transaction
        await db.transaction(async (tx) => {
            // 1. Delete projects owned by the user (cascade handles members, tasks, nodes, etc.)
            await tx.delete(projects).where(eq(projects.ownerId, userId));

            // 2. Delete the profile (cascade handles remaining FKs)
            await tx.delete(profiles).where(eq(profiles.id, userId));

            // 3. Mark deletion as completed
            await tx
                .update(accountDeletions)
                .set({ completedAt: new Date(), cleanupStatus: 'completed' })
                .where(eq(accountDeletions.id, deletionId));
        });

        // Delete the auth user
        const supabase = await createClient();
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
            console.error('Auth deletion error (hard delete):', authError);
        }

        return { success: true };
    } catch (error) {
        console.error('Hard delete error:', error);

        // Mark the deletion as failed
        try {
            await db
                .update(accountDeletions)
                .set({
                    cleanupStatus: 'failed',
                    cleanupDetails: {
                        error: error instanceof Error ? error.message : String(error),
                        failedAt: new Date().toISOString(),
                    },
                })
                .where(eq(accountDeletions.id, deletionId));
        } catch {
            // Best effort
        }

        return { success: false, error: 'Failed to execute hard delete' };
    }
}

// ============================================================================
// TRANSFER PROJECT OWNERSHIP
// ============================================================================

/**
 * Transfer ownership of a project to another user (must be a project member).
 * Used during the deletion wizard to preserve team projects.
 */
export async function transferProjectOwnership(
    projectId: string,
    newOwnerId: string,
): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, error: 'Not authenticated' };
        }

        if (!UUID_RE.test(projectId) || !UUID_RE.test(newOwnerId)) {
            return { success: false, error: 'Invalid IDs' };
        }

        const { projectMembers } = await import('@/lib/db/schema');

        await db.transaction(async (tx) => {
            // Verify current user owns the project
            const [project] = await tx
                .select({ ownerId: projects.ownerId })
                .from(projects)
                .where(eq(projects.id, projectId))
                .limit(1);

            if (!project || project.ownerId !== user.id) {
                throw new Error('Not the project owner');
            }

            // Verify new owner is a project member
            const [membership] = await tx
                .select({ id: projectMembers.id })
                .from(projectMembers)
                .where(
                    and(
                        eq(projectMembers.projectId, projectId),
                        eq(projectMembers.userId, newOwnerId),
                    )
                )
                .limit(1);

            if (!membership) {
                throw new Error('New owner must be a project member');
            }

            // Transfer ownership
            await tx
                .update(projects)
                .set({
                    ownerId: newOwnerId,
                    updatedAt: new Date(),
                })
                .where(eq(projects.id, projectId));

            // Update member roles
            await tx
                .update(projectMembers)
                .set({ role: 'owner' })
                .where(
                    and(
                        eq(projectMembers.projectId, projectId),
                        eq(projectMembers.userId, newOwnerId),
                    )
                );
        });

        return { success: true };
    } catch (error) {
        console.error('Transfer ownership error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to transfer ownership',
        };
    }
}

// ============================================================================
// EXPORT ACCOUNT DATA
// ============================================================================

/**
 * Export all user data as a structured JSON object.
 * GDPR Article 20 — Right to Data Portability.
 */
export async function exportAccountData(): Promise<{
    success: boolean;
    data?: Record<string, unknown>;
    error?: string;
}> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, error: 'Not authenticated' };
        }

        const userId = user.id;

        // Optimized parallel fetching with explicit column selection
        const [
            [profile],
            userProjects,
            userConnections,
            userMessages,
            userCollections
        ] = await Promise.all([
            readDb
                .select({
                    email: profiles.email,
                    username: profiles.username,
                    fullName: profiles.fullName,
                    bio: profiles.bio,
                    headline: profiles.headline,
                    location: profiles.location,
                    website: profiles.website,
                    skills: profiles.skills,
                    interests: profiles.interests,
                    experience: profiles.experience,
                    education: profiles.education,
                    openTo: profiles.openTo,
                    socialLinks: profiles.socialLinks,
                    experienceLevel: profiles.experienceLevel,
                    pronouns: profiles.pronouns,
                    createdAt: profiles.createdAt,
                })
                .from(profiles)
                .where(eq(profiles.id, userId))
                .limit(1),
            readDb
                .select({
                    id: projects.id,
                    title: projects.title,
                    slug: projects.slug,
                    description: projects.description,
                    category: projects.category,
                    status: projects.status,
                    visibility: projects.visibility,
                    tags: projects.tags,
                    skills: projects.skills,
                    createdAt: projects.createdAt,
                })
                .from(projects)
                .where(eq(projects.ownerId, userId)),
            readDb
                .select({
                    requesterId: connections.requesterId,
                    addresseeId: connections.addresseeId,
                    status: connections.status,
                    createdAt: connections.createdAt,
                })
                .from(connections)
                .where(
                    or(
                        eq(connections.requesterId, userId),
                        eq(connections.addresseeId, userId),
                    )
                ),
            readDb
                .select({
                    id: messages.id,
                    conversationId: messages.conversationId,
                    content: messages.content,
                    type: messages.type,
                    createdAt: messages.createdAt,
                })
                .from(messages)
                .where(eq(messages.senderId, userId)),
            readDb
                .select({
                    id: collections.id,
                    name: collections.name,
                    createdAt: collections.createdAt,
                })
                .from(collections)
                .where(eq(collections.ownerId, userId))
        ]);

        const exportData = {
            exportedAt: new Date().toISOString(),
            profile,
            projects: userProjects,
            connections: userConnections.map(c => ({
                ...c,
                direction: c.requesterId === userId ? 'sent' : 'received',
            })),
            messages: {
                count: userMessages.length,
                items: userMessages,
            },
            collections: userCollections,
        };

        // Write to S3 with exports/ prefix for lifecycle rules
        const fileName = `exports/account-data-${user.id}-${Date.now()}.json`;
        const { error: uploadError } = await supabase.storage
            .from('exports') // Recommended to use a dedicated bucket
            .upload(fileName, JSON.stringify(exportData), {
                contentType: 'application/json',
                cacheControl: '3600',
                upsert: false
            });

        if (uploadError) {
            console.error('S3 upload error during data export:', uploadError);
            return { success: false, error: 'Failed to upload exported data' };
        }

        return { success: true, data: exportData };
    } catch (error) {
        console.error('Data export error:', error);
        return { success: false, error: 'Failed to export account data' };
    }
}

// ============================================================================
// GET ACCOUNT DELETION STATUS
// ============================================================================

/**
 * Get the user's pending deletion status (if any).
 */
export async function getAccountDeletionStatus(): Promise<{
    pending: boolean;
    deletionId?: string;
    hardDeleteAt?: string;
    scheduledAt?: string;
}> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { pending: false };
        }

        const [activeDeletion] = await readDb
            .select({
                id: accountDeletions.id,
                hardDeleteAt: accountDeletions.hardDeleteAt,
                scheduledAt: accountDeletions.scheduledAt,
            })
            .from(accountDeletions)
            .where(
                and(
                    eq(accountDeletions.userId, user.id),
                    isNull(accountDeletions.cancelledAt),
                    isNull(accountDeletions.completedAt),
                )
            )
            .orderBy(desc(accountDeletions.scheduledAt))
            .limit(1);

        if (!activeDeletion) {
            return { pending: false };
        }

        return {
            pending: true,
            deletionId: activeDeletion.id,
            hardDeleteAt: activeDeletion.hardDeleteAt.toISOString(),
            scheduledAt: activeDeletion.scheduledAt.toISOString(),
        };
    } catch {
        return { pending: false };
    }
}

// ============================================================================
// GET ACCOUNT DATA SUMMARY (for deletion wizard Step 1)
// ============================================================================

/**
 * Get a summary of user's data for the deletion wizard.
 */
export async function getAccountDataSummary(): Promise<{
    success: boolean;
    summary?: {
        projectsCount: number;
        connectionsCount: number;
        messagesCount: number;
        filesCount: number;
        collectionsCount: number;
    };
    error?: string;
}> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, error: 'Not authenticated' };
        }

        const userId = user.id;

        // High-Performance Optimization: Use parallel COUNT queries with subqueries/joins
        // to avoid N+1 issues and multiple round-trips.
        const [counts] = await readDb
            .select({
                projects: sql<number>`(SELECT count(*)::int FROM ${projects} WHERE ${projects.ownerId} = ${userId})`,
                connections: sql<number>`(SELECT count(*)::int FROM ${connections} WHERE (${connections.requesterId} = ${userId} OR ${connections.addresseeId} = ${userId}) AND ${connections.status} = 'accepted')`,
                messages: sql<number>`(SELECT count(*)::int FROM ${messages} WHERE ${messages.senderId} = ${userId})`,
                collections: sql<number>`(SELECT count(*)::int FROM ${collections} WHERE ${collections.ownerId} = ${userId})`,
                files: sql<number>`(
                    SELECT count(*)::int 
                    FROM "project_nodes" pn
                    JOIN "projects" p ON pn."project_id" = p."id"
                    WHERE p."owner_id" = ${userId} AND pn."type" = 'file'
                )`,
            })
            .from(profiles)
            .where(eq(profiles.id, userId))
            .limit(1);

        return {
            success: true,
            summary: {
                projectsCount: counts?.projects || 0,
                connectionsCount: counts?.connections || 0,
                messagesCount: counts?.messages || 0,
                filesCount: counts?.files || 0,
                collectionsCount: counts?.collections || 0,
            },
        };
    } catch (error) {
        console.error('Data summary error:', error);
        return { success: false, error: 'Failed to get account data summary' };
    }
}

// ============================================================================
// GET USER'S TRANSFERABLE PROJECTS (for wizard Step 3)
// ============================================================================

/**
 * Get projects owned by the user that have other members (eligible for transfer).
 */
export async function getTransferableProjects(): Promise<{
    success: boolean;
    projects?: Array<{
        id: string;
        title: string;
        slug: string | null;
        members: Array<{ userId: string; username: string | null; fullName: string | null; role: string }>;
    }>;
    error?: string;
}> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Not authenticated" };

    try {
        // High-Performance: Use readDb and optimized JOIN to fetch projects and members
        const results = await readDb
            .select({
                projectId: projects.id,
                title: projects.title,
                slug: projects.slug,
                memberUserId: projectMembers.userId,
                memberUsername: profiles.username,
                memberFullName: profiles.fullName,
                memberRole: projectMembers.role,
            })
            .from(projects)
            .innerJoin(projectMembers, eq(projects.id, projectMembers.projectId))
            .innerJoin(profiles, eq(projectMembers.userId, profiles.id))
            .where(and(eq(projects.ownerId, user.id), ne(projectMembers.userId, user.id)));

        // Group members by project
        const projectMap = new Map<string, any>();
        for (const row of results) {
            if (!projectMap.has(row.projectId)) {
                projectMap.set(row.projectId, {
                    id: row.projectId,
                    title: row.title,
                    slug: row.slug,
                    members: []
                });
            }
            projectMap.get(row.projectId).members.push({
                userId: row.memberUserId,
                username: row.memberUsername,
                fullName: row.memberFullName,
                role: row.memberRole
            });
        }

        return { success: true, projects: Array.from(projectMap.values()) };
    } catch (error) {
        console.error('Transferable projects error:', error);
        return { success: false, error: 'Failed to get transferable projects' };
    }
}

// ============================================================================
// ADMIN: CLEANUP ORPHANED PROFILE
// ============================================================================

/**
 * Clean up orphaned profiles (profiles that exist in DB but not in Auth).
 * This is an admin-only function for maintenance.
 */
export async function cleanupOrphanedProfile(profileId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, error: 'Not authenticated' };
        }
        if (!isAdminUser(user)) {
            return { success: false, error: 'Forbidden' };
        }
        if (!UUID_RE.test(profileId)) {
            return { success: false, error: 'Invalid profile id' };
        }

        // First, check if the profile exists (explicit selection)
        const [profile] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, profileId)).limit(1);

        if (!profile) {
            return { success: false, error: 'Profile not found' };
        }

        const affectedConnectionRows = await db
            .select({
                requesterId: connections.requesterId,
                addresseeId: connections.addresseeId,
            })
            .from(connections)
            .where(
                or(
                    eq(connections.requesterId, profileId),
                    eq(connections.addresseeId, profileId)
                )
            );

        const affectedUserIds = affectedConnectionRows
            .flatMap((row) => [
                row.requesterId === profileId ? null : row.requesterId,
                row.addresseeId === profileId ? null : row.addresseeId,
            ])
            .filter((id): id is string => id !== null);

        await db.transaction(async (tx) => {
            // Delete associated data
            await tx.delete(projects).where(eq(projects.ownerId, profileId));
            await tx.delete(connections).where(
                or(
                    eq(connections.requesterId, profileId),
                    eq(connections.addresseeId, profileId)
                )
            );

            // Delete the profile
            await tx.delete(profileAuditEvents).where(eq(profileAuditEvents.userId, profileId));
            await tx.delete(profiles).where(eq(profiles.id, profileId));
        });

        if (affectedUserIds.length > 0) {
            await queueCounterRefreshBestEffort(affectedUserIds);
        }

        revalidatePath('/people');
        return { success: true };
    } catch (error) {
        console.error('Cleanup error:', error);
        return { success: false, error: 'Failed to cleanup profile' };
    }
}

