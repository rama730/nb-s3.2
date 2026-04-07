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
import { logger } from '@/lib/logger';
import { randomBytes } from 'crypto';

const UUID_RE =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const ACCOUNT_DELETE_CONFIRM_TEXT = 'DELETE';
const GRACE_PERIOD_DAYS = 30;
const CONFIRMATION_TOKEN_EXPIRY_HOURS = 1;
const ACCOUNT_EXPORT_MESSAGE_LIMIT = 10_000;

type AccountExportMessageRow = {
    id: string;
    conversationId: string;
    content: string | null;
    type: string | null;
    createdAt: Date;
    senderId: string | null;
};

function sanitizeExportedMessages(rows: AccountExportMessageRow[], userId: string) {
    return rows.map((row) => {
        const direction =
            row.senderId === userId
                ? 'sent'
                : row.senderId === null
                    ? 'system'
                    : 'received';

        return {
            id: row.id,
            conversationId: row.conversationId,
            content: direction === 'sent' || direction === 'system' ? row.content : null,
            type: row.type,
            createdAt: row.createdAt,
            direction,
            sender: direction === 'sent' ? 'self' : direction === 'system' ? 'system' : 'other-redacted',
            redacted: direction === 'received',
        };
    });
}

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

            // 3. Delete connections (both sent and received)
            await tx.delete(connections).where(
                or(
                    eq(connections.requesterId, userId),
                    eq(connections.addresseeId, userId)
                )
            );

            // 4. Decrement followersCount on projects the user follows
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

            // 5. Delete project follows by user
            await tx.delete(projectFollows).where(eq(projectFollows.userId, userId));

            // 6. Delete user's collections
            await tx.delete(collections).where(eq(collections.ownerId, userId));

            // 7. Delete user's profile audit events
            await tx.delete(profileAuditEvents).where(eq(profileAuditEvents.userId, userId));

            return deletion.id;
        });

        // Counter refresh (outside transaction — non-critical for consistency)
        try {
            if (affectedUserIds.length > 0) {
                await queueCounterRefreshBestEffort(affectedUserIds);
            }
        } catch (counterErr) {
            logger.warn('account.counter-refresh.failed', { module: 'account', error: counterErr instanceof Error ? counterErr.message : String(counterErr) });
        }

        // Dispatch async S3 cleanup via Inngest
        try {
            const { inngest } = await import('@/inngest/client');
            await inngest.send({
                name: 'account/cleanup',
                data: { userId, deletionId },
            });
        } catch (inngestErr) {
            logger.warn('account.inngest-dispatch.failed', { module: 'account', error: inngestErr instanceof Error ? inngestErr.message : String(inngestErr) });
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
        logger.error('account.deletion.scheduling.failed', { module: 'account', error: error instanceof Error ? error.message : String(error) });
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
        logger.error('account.cancel-deletion.failed', { module: 'account', error: error instanceof Error ? error.message : String(error) });
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

        // C9: Delete auth user FIRST to avoid orphaned auth records.
        // If auth deletion fails, DB data is preserved and can be retried.
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
            logger.error('account.hard-delete.auth-deletion.failed', { module: 'account', error: authError.message });
            // Auth deletion failed — abort to prevent orphaned auth record.
            // The Inngest job will retry on next scheduled attempt.
            return { success: false, error: `Auth deletion failed: ${authError.message}` };
        }

        // Run destructive DB deletes in a transaction (auth user already removed)
        await db.transaction(async (tx) => {
            // 1. Remove the user from conversations during the irreversible finalizer path.
            await tx.delete(conversationParticipants).where(
                eq(conversationParticipants.userId, userId)
            );

            // 2. Remove DM pair entries during hard delete so soft delete remains reversible.
            await tx.delete(dmPairs).where(
                or(
                    eq(dmPairs.userLow, userId),
                    eq(dmPairs.userHigh, userId),
                )
            );

            // 3. Delete projects owned by the user (cascade handles members, tasks, nodes, etc.)
            await tx.delete(projects).where(eq(projects.ownerId, userId));

            // 4. Delete the profile (cascade handles remaining FKs)
            await tx.delete(profiles).where(eq(profiles.id, userId));

            // 5. Mark deletion as completed
            await tx
                .update(accountDeletions)
                .set({ completedAt: new Date(), cleanupStatus: 'completed' })
                .where(eq(accountDeletions.id, deletionId));
        });

        return { success: true };
    } catch (error) {
        logger.error('account.hard-delete.failed', { module: 'account', error: error instanceof Error ? error.message : String(error) });

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
        logger.error('account.transfer-ownership.failed', { module: 'account', error: error instanceof Error ? error.message : String(error) });
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
            [{ count: userMessageCount }],
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
                .where(eq(projects.ownerId, userId))
                .limit(5_000),
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
                )
                .limit(50_000),
            readDb
                .select({
                    id: messages.id,
                    conversationId: messages.conversationId,
                    content: messages.content,
                    type: messages.type,
                    createdAt: messages.createdAt,
                    senderId: messages.senderId,
                })
                .from(messages)
                .innerJoin(
                    conversationParticipants,
                    and(
                        eq(conversationParticipants.conversationId, messages.conversationId),
                        eq(conversationParticipants.userId, userId),
                    ),
                )
                .orderBy(desc(messages.createdAt))
                .limit(ACCOUNT_EXPORT_MESSAGE_LIMIT),
            readDb
                .select({
                    count: sql<number>`count(distinct ${messages.id})::int`,
                })
                .from(messages)
                .innerJoin(
                    conversationParticipants,
                    and(
                        eq(conversationParticipants.conversationId, messages.conversationId),
                        eq(conversationParticipants.userId, userId),
                    ),
                ),
            readDb
                .select({
                    id: collections.id,
                    name: collections.name,
                    createdAt: collections.createdAt,
                })
                .from(collections)
                .where(eq(collections.ownerId, userId))
                .limit(10_000)
        ]);

        const sanitizedMessages = sanitizeExportedMessages(userMessages, userId);
        const messageNotes: string[] = [];
        if (userMessageCount > sanitizedMessages.length) {
            messageNotes.push(
                `Message export limited to ${ACCOUNT_EXPORT_MESSAGE_LIMIT.toLocaleString()} most recent messages. Contact support for a complete export.`,
            );
        }
        if (sanitizedMessages.some((message) => message.redacted)) {
            messageNotes.push(
                'Received message content and sender identity are redacted to protect the rights and freedoms of other participants under GDPR Article 20(4).',
            );
        }

        const exportData = {
            exportedAt: new Date().toISOString(),
            profile,
            projects: userProjects,
            connections: userConnections.map(c => ({
                ...c,
                direction: c.requesterId === userId ? 'sent' : 'received',
            })),
            messages: {
                count: userMessageCount,
                exportedCount: sanitizedMessages.length,
                truncated: userMessageCount > sanitizedMessages.length,
                note: messageNotes.length > 0 ? messageNotes.join(' ') : undefined,
                items: sanitizedMessages,
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
            logger.error('account.export.upload.failed', { module: 'account', error: uploadError.message });
            return { success: false, error: 'Failed to upload exported data' };
        }

        return { success: true, data: exportData };
    } catch (error) {
        logger.error('account.export.failed', { module: 'account', error: error instanceof Error ? error.message : String(error) });
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
                messages: sql<number>`(
                    SELECT count(*)::int
                    FROM ${messages}
                    WHERE EXISTS (
                        SELECT 1
                        FROM ${conversationParticipants}
                        WHERE ${conversationParticipants.conversationId} = ${messages.conversationId}
                          AND ${conversationParticipants.userId} = ${userId}
                    )
                )`,
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
        logger.error('account.data-summary.failed', { module: 'account', error: error instanceof Error ? error.message : String(error) });
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
        logger.error('account.transferable-projects.failed', { module: 'account', error: error instanceof Error ? error.message : String(error) });
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
        logger.error('account.cleanup.failed', { module: 'account', error: error instanceof Error ? error.message : String(error) });
        return { success: false, error: 'Failed to cleanup profile' };
    }
}
