'use server';

import { db, readDb } from "@/lib/db";
import {
    profiles,
    projects,
    connections,
    projectMembers,
    messages,
    conversationParticipants,
    collections,
    accountDeletions,
    profileAuditEvents,
    projectFollows
} from "@/lib/db/schema";
import { createClient } from '@/lib/supabase/server';
import { isAdminUser } from '@/lib/security/admin';
import { eq, or, and, inArray, isNull, sql, desc, ne } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { queueCounterRefreshBestEffort } from '@/lib/workspace/counter-buffer';
import { logger } from '@/lib/logger';
import { randomBytes } from 'crypto';
import { createSignedJobRequestToken } from '@/lib/security/job-request';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { resolveSecurityStepUp } from '@/lib/security/step-up';

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
                data: {
                    userId,
                    deletionId,
                    jobSignature: createSignedJobRequestToken({
                        kind: 'account/cleanup',
                        actorId: userId,
                        subjectId: deletionId,
                    }),
                },
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
// EXECUTE HARD DELETE
// ============================================================================
//
// SEC-C3: the destructive finalizer now lives in `src/lib/account/hard-delete`
// so it is NEVER exposed as a 'use server' RPC action. Only the Inngest cron
// imports it, and every call must carry a signed job-request token that binds
// the request to a (userId, deletionId) pair.

// ============================================================================
// TRANSFER PROJECT OWNERSHIP
// ============================================================================

/**
 * Transfer ownership of a project to another user (must be a project member).
 * Used during the deletion wizard to preserve team projects.
 *
 * SEC-C4: transferring ownership can be weaponised to hand a project to a
 * compromised account before it is hard-deleted, effectively destroying the
 * original owner's work. Hardening:
 *   - per-user rate limit to cap damage from a stolen session;
 *   - step-up auth required (recent password / TOTP / recovery code);
 *   - `SELECT ... FOR UPDATE` on the project row so concurrent owner mutations
 *     can't race the ownership check;
 *   - audit entry on the original owner AND the new owner so either party can
 *     trace the transfer later.
 */
export async function transferProjectOwnership(
    projectId: string,
    newOwnerId: string,
): Promise<{ success: boolean; error?: string; errorCode?: 'UNAUTHORIZED' | 'STEP_UP_REQUIRED' | 'RATE_LIMITED' | 'VALIDATION_ERROR' | 'NOT_OWNER' | 'NOT_A_MEMBER' | 'PROJECT_NOT_FOUND' | 'INTERNAL_ERROR' }> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, error: 'Not authenticated', errorCode: 'UNAUTHORIZED' };
        }

        if (!UUID_RE.test(projectId) || !UUID_RE.test(newOwnerId)) {
            return { success: false, error: 'Invalid IDs', errorCode: 'VALIDATION_ERROR' };
        }

        if (newOwnerId === user.id) {
            return {
                success: false,
                error: 'Cannot transfer ownership to yourself',
                errorCode: 'VALIDATION_ERROR',
            };
        }

        // SEC-C4: cap the rate of ownership transfers per user. 10 transfers
        // per hour is well above any legitimate deletion-wizard flow but low
        // enough that an attacker with a valid session cannot sweep an
        // entire project portfolio before we notice.
        const rate = await consumeRateLimit(
            `account:transfer-ownership:${user.id}`,
            10,
            60 * 60,
        );
        if (!rate.allowed) {
            return {
                success: false,
                error: 'Too many transfer attempts. Please try again later.',
                errorCode: 'RATE_LIMITED',
            };
        }

        // SEC-C4: require a fresh step-up — same invariant as account deletion
        // because transferring ownership is effectively a silent privilege
        // hand-off on the project.
        const stepUp = await resolveSecurityStepUp(user.id);
        if (!stepUp.ok) {
            return {
                success: false,
                error: 'Re-authenticate to transfer project ownership.',
                errorCode: 'STEP_UP_REQUIRED',
            };
        }

        const transferResult = await db.transaction(async (tx) => {
            // SEC-C4: `FOR UPDATE` locks the project row for the duration of
            // the transaction so a second caller (e.g. a parallel transfer or
            // a soft-delete) cannot race the owner check.
            const lockedRows = await tx.execute<{ owner_id: string }>(sql`
                SELECT owner_id FROM ${projects} WHERE id = ${projectId} FOR UPDATE
            `);
            const lockedProject = Array.from(lockedRows)[0];

            if (!lockedProject) {
                return { ok: false as const, code: 'PROJECT_NOT_FOUND' as const };
            }
            if (lockedProject.owner_id !== user.id) {
                return { ok: false as const, code: 'NOT_OWNER' as const };
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
                return { ok: false as const, code: 'NOT_A_MEMBER' as const };
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

            // Demote the previous owner to 'admin' on the project so they
            // lose the destructive capabilities tied to the 'owner' role.
            await tx
                .update(projectMembers)
                .set({ role: 'admin' })
                .where(
                    and(
                        eq(projectMembers.projectId, projectId),
                        eq(projectMembers.userId, user.id),
                    )
                );

            // SEC-C4: write an audit trail row for BOTH parties so either
            // user can see the transfer in their audit log. `user_id` here
            // points at the affected user (previous or new owner), and
            // `metadata.actor_id` records the acting party.
            const now = new Date();
            await tx.insert(profileAuditEvents).values([
                {
                    userId: user.id,
                    eventType: 'project_ownership_transferred_out',
                    previousValue: { ownerId: user.id },
                    nextValue: { ownerId: newOwnerId },
                    metadata: {
                        projectId,
                        newOwnerId,
                        actorId: user.id,
                        stepUpMethod: stepUp.payload?.method ?? null,
                        at: now.toISOString(),
                    },
                },
                {
                    userId: newOwnerId,
                    eventType: 'project_ownership_transferred_in',
                    previousValue: { ownerId: user.id },
                    nextValue: { ownerId: newOwnerId },
                    metadata: {
                        projectId,
                        previousOwnerId: user.id,
                        actorId: user.id,
                        at: now.toISOString(),
                    },
                },
            ]);

            return { ok: true as const };
        });

        if (!transferResult.ok) {
            switch (transferResult.code) {
                case 'NOT_OWNER':
                    return { success: false, error: 'Not the project owner', errorCode: 'NOT_OWNER' };
                case 'NOT_A_MEMBER':
                    return { success: false, error: 'New owner must be a project member', errorCode: 'NOT_A_MEMBER' };
                case 'PROJECT_NOT_FOUND':
                    return { success: false, error: 'Project not found', errorCode: 'PROJECT_NOT_FOUND' };
            }
        }

        logger.info('account.transfer-ownership.completed', {
            module: 'account',
            projectId,
            previousOwnerId: user.id,
            newOwnerId,
        });

        return { success: true };
    } catch (error) {
        logger.error('account.transfer-ownership.failed', { module: 'account', error: error instanceof Error ? error.message : String(error) });
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to transfer ownership',
            errorCode: 'INTERNAL_ERROR',
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
            // SEC-L1: exporting the raw counterparty UUID leaks an internal
            // identifier that the data subject does not need and that could be
            // weaponised to correlate accounts across exported corpora. Strip
            // `requesterId` / `addresseeId` and keep only the
            // direction-from-the-exporter and status/createdAt.
            connections: userConnections.map((c) => ({
                direction: c.requesterId === userId ? 'sent' : 'received',
                status: c.status,
                createdAt: c.createdAt,
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
