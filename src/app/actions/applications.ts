'use server';

import { db } from '@/lib/db';
import {
    roleApplications,
    projectOpenRoles,
    projects,
    projectMembers,
    connections,
    conversations,
    dmPairs,
    conversationParticipants,
    messages,
    profiles
} from '@/lib/db/schema';
import { eq, and, sql, or, inArray } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { ensureProjectGroupExists } from './project';

// ============================================================================
// TYPES
// ============================================================================
interface ApplicationResult {
    success: boolean;
    error?: string;
    applicationId?: string;
    conversationId?: string;
}

interface ApplicationStatus {
    status: 'none' | 'pending' | 'accepted' | 'rejected';
    roleId?: string;
    roleTitle?: string;
    canReapply?: boolean;
    waitTime?: string;
    updatedAt?: Date;
}

// ============================================================================
// COOLDOWN HELPER (24 hours)
// ============================================================================
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

function calculateCooldown(updatedAt: Date): { canApply: boolean; waitTime?: string } {
    const elapsed = Date.now() - new Date(updatedAt).getTime();

    if (elapsed >= COOLDOWN_MS) {
        return { canApply: true };
    }

    const remaining = COOLDOWN_MS - elapsed;
    const hours = Math.floor(remaining / (60 * 60 * 1000));
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));

    return { canApply: false, waitTime: `${hours}h ${minutes}m` };
}

// ============================================================================
// INTERNAL HELPER: Send application message to chat (no re-auth needed)
// ============================================================================
async function getOrCreateDmConversationIdInternal(
    tx: any,
    userA: string,
    userB: string
): Promise<string> {
    const [low, high] = userA < userB ? [userA, userB] : [userB, userA];

    // Serialize DM creation per pair to prevent duplicate conversations under concurrency.
    await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
            hashtext(CAST(${low} AS text)),
            hashtext(CAST(${high} AS text))
        )
    `);

    // 1. Check optimized dm_pairs table first
    const existing = await tx
        .select({ conversationId: dmPairs.conversationId })
        .from(dmPairs)
        .where(and(eq(dmPairs.userLow, low), eq(dmPairs.userHigh, high)))
        .limit(1);

    if (existing[0]?.conversationId) {
        // Ensure participants exist (repair if needed).
        await tx.insert(conversationParticipants)
            .values([
                { conversationId: existing[0].conversationId, userId: userA },
                { conversationId: existing[0].conversationId, userId: userB },
            ])
            .onConflictDoNothing({
                target: [conversationParticipants.conversationId, conversationParticipants.userId],
            });

        return existing[0].conversationId;
    }

    // 2. Fallback: Check for legacy conversation (missing from dm_pairs)
    // Find a 'dm' conversation where BOTH users are participants
    const legacyConversation = await tx.execute(sql`
        SELECT c.id 
        FROM ${conversations} c
        WHERE c.type = 'dm'
        AND EXISTS (
            SELECT 1 FROM ${conversationParticipants} cp1
            WHERE cp1.conversation_id = c.id AND cp1.user_id = ${userA}
        )
        AND EXISTS (
            SELECT 1 FROM ${conversationParticipants} cp2
            WHERE cp2.conversation_id = c.id AND cp2.user_id = ${userB}
        )
        LIMIT 1
    `);

    if (legacyConversation.length > 0) {
        const foundId = legacyConversation[0].id;

        // Backfill dm_pairs for future O(1) lookup
        await tx.insert(dmPairs)
            .values({
                userLow: low,
                userHigh: high,
                conversationId: foundId,
            })
            .onConflictDoNothing();

        return foundId;
    }

    // 3. Create new conversation if absolutely nothing exists
    const [newConversation] = await tx
        .insert(conversations)
        .values({ type: 'dm' })
        .returning({ id: conversations.id });

    await tx.insert(conversationParticipants)
        .values([
            { conversationId: newConversation.id, userId: userA },
            { conversationId: newConversation.id, userId: userB },
        ])
        .onConflictDoNothing({
            target: [conversationParticipants.conversationId, conversationParticipants.userId],
        });

    await tx.insert(dmPairs).values({
        userLow: low,
        userHigh: high,
        conversationId: newConversation.id,
    });

    return newConversation.id;
}

async function sendApplicationMessageInternal(
    tx: any,
    applicantId: string,
    creatorId: string,
    projectId: string,
    roleId: string,
    projectTitle: string,
    roleTitle: string,
    userMessage: string,
    applicationId: string
): Promise<{ conversationId: string }> {
    // 1) Ensure a single DM conversation for this user pair
    const conversationId = await getOrCreateDmConversationIdInternal(tx, applicantId, creatorId);

    // 2) Insert the application message
    const applicationMessage = `${projectTitle} / ${roleTitle}\n\n${userMessage}`;

    await tx.insert(messages).values({
        conversationId,
        senderId: applicantId,
        content: applicationMessage,
        type: 'text',
        metadata: {
            kind: 'application',
            isApplication: true,
            applicationId,
            projectId,
            roleId,
            projectTitle,
            roleTitle,
            status: 'pending'
        }
    });

    // 3) Update conversation timestamp for sorting
    await tx
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, conversationId));

    return { conversationId };
}

// ============================================================================
// INTERNAL HELPER: Send status update message to chat
// ============================================================================
// ============================================================================
// INTERNAL HELPER: Send status update message to chat
// ============================================================================
async function sendApplicationStatusUpdateInternal(
    tx: any,
    conversationId: string,
    creatorId: string,
    applicationId: string,
    projectId: string,
    roleId: string,
    projectTitle: string,
    roleTitle: string,
    status: 'accepted' | 'rejected',
    customMessage?: string,
    reason?: string
): Promise<void> {
    const statusText = status === 'accepted' ? 'Accepted' : 'Not Accepted';
    let messageText = `Application ${statusText}`; // Short text for system message summary

    // We can put detailed info in metadata for the UI if needed,
    // but the system message should be clean "Timeline Divider" style.

    await tx.insert(messages).values({
        conversationId,
        senderId: creatorId,
        content: messageText,
        type: 'system', // CHANGED: System type for Timeline Divider
        metadata: {
            kind: 'application_update',
            isApplicationUpdate: true,
            applicationId,
            projectId,
            roleId,
            projectTitle,
            roleTitle,
            status,
            reason,
            customMessage
        }
    });

    // Update conversation timestamp
    await tx
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, conversationId));
}

// ============================================================================
// GET APPLICATION STATUS (for project page)
// ============================================================================
export async function getApplicationStatusAction(projectId: string): Promise<ApplicationStatus> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { status: 'none' };
        }

        const application = await db.query.roleApplications.findFirst({
            where: and(
                eq(roleApplications.projectId, projectId),
                eq(roleApplications.applicantId, user.id)
            ),
            with: {
                role: {
                    columns: { role: true, title: true }
                }
            },
            columns: { status: true, roleId: true, updatedAt: true }
        });

        if (!application) {
            return { status: 'none' };
        }

        const roleTitle = application.role?.title || application.role?.role || 'Unknown Role';

        if (application.status === 'rejected') {
            const { canApply, waitTime } = calculateCooldown(application.updatedAt);
            return {
                status: 'rejected',
                roleId: application.roleId,
                roleTitle,
                canReapply: canApply,
                waitTime,
                updatedAt: application.updatedAt
            };
        }

        return {
            status: application.status as 'pending' | 'accepted',
            roleId: application.roleId,
            roleTitle,
            updatedAt: application.updatedAt
        };
    } catch (error) {
        console.error('Failed to get application status:', error);
        return { status: 'none' };
    }
}

// ============================================================================
// APPLY TO ROLE ACTION
// ============================================================================
export async function applyToRoleAction(
    projectId: string,
    roleId: string,
    message: string
): Promise<ApplicationResult> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, error: 'You must be logged in to apply' };
        }

        // OPTIMIZATION: Batch all read queries into a single parallel fetch
        const [project, role, existingMember, existingApp] = await Promise.all([
            db.query.projects.findFirst({
                where: eq(projects.id, projectId),
                columns: { id: true, ownerId: true, slug: true, title: true }
            }),
            db.query.projectOpenRoles.findFirst({
                where: eq(projectOpenRoles.id, roleId),
                columns: { id: true, role: true, title: true, count: true, filled: true }
            }),
            db.query.projectMembers.findFirst({
                where: and(
                    eq(projectMembers.projectId, projectId),
                    eq(projectMembers.userId, user.id)
                ),
                columns: { id: true }
            }),
            db.query.roleApplications.findFirst({
                where: and(
                    eq(roleApplications.projectId, projectId),
                    eq(roleApplications.applicantId, user.id)
                ),
                columns: { id: true, status: true, updatedAt: true }
            })
        ]);

        // Validation checks (fail fast)
        if (!project) {
            return { success: false, error: 'Project not found' };
        }
        if (project.ownerId === user.id) {
            return { success: false, error: 'You cannot apply to your own project' };
        }
        if (!role) {
            return { success: false, error: 'Role not found' };
        }
        if (role.filled >= role.count) {
            return { success: false, error: 'This role has no available spots' };
        }
        if (existingMember) {
            return { success: false, error: 'You are already a team member' };
        }

        const trimmedMessage = message.trim();
        const roleTitleText = role?.title || role?.role || 'Unknown Role';

        // Handle existing application states
        if (existingApp) {
            if (existingApp.status === 'pending') {
                return { success: false, error: 'You already have a pending application' };
            }
            if (existingApp.status === 'accepted') {
                return { success: false, error: 'Your application was already accepted' };
            }
            if (existingApp.status === 'rejected') {
                const { canApply, waitTime } = calculateCooldown(existingApp.updatedAt);
                if (!canApply) {
                    return { success: false, error: `You can reapply in ${waitTime}` };
                }

                const { conversationId } = await db.transaction(async (tx) => {
                    // Update existing rejected application (upsert pattern)
                    await tx.update(roleApplications)
                        .set({
                            roleId,
                            message: trimmedMessage,
                            status: 'pending',
                            updatedAt: new Date()
                        })
                        .where(eq(roleApplications.id, existingApp.id));

                    // Send reapplication message to chat (atomic with the application update)
                    const { conversationId } = await sendApplicationMessageInternal(
                        tx,
                        user.id,
                        project.ownerId,
                        projectId,
                        roleId,
                        project.title || 'Project',
                        roleTitleText,
                        trimmedMessage,
                        existingApp.id
                    );

                    // Store conversation ID for linking
                    await tx.update(roleApplications)
                        .set({ conversationId })
                        .where(eq(roleApplications.id, existingApp.id));

                    return { conversationId };
                });

                revalidatePath(`/projects/${project.slug || projectId}`);
                revalidatePath('/messages');
                return { success: true, applicationId: existingApp.id, conversationId };
            }
        }

        const { applicationId: newApplicationId, conversationId } = await db.transaction(async (tx) => {
            // Create new application with message
            const [newApp] = await tx.insert(roleApplications)
                .values({
                    projectId,
                    roleId,
                    applicantId: user.id,
                    creatorId: project.ownerId,
                    message: trimmedMessage,
                    status: 'pending'
                })
                .returning({ id: roleApplications.id });

            // Send application message to chat (atomic with application insert)
            const { conversationId } = await sendApplicationMessageInternal(
                tx,
                user.id,
                project.ownerId,
                projectId,
                roleId,
                project.title || 'Project',
                roleTitleText,
                trimmedMessage,
                newApp.id
            );

            // Store conversation ID for linking
            await tx.update(roleApplications)
                .set({ conversationId })
                .where(eq(roleApplications.id, newApp.id));

            return { applicationId: newApp.id, conversationId };
        });

        revalidatePath(`/projects/${project.slug || projectId}`);
        revalidatePath('/messages');
        revalidatePath('/people');

        return { success: true, applicationId: newApplicationId, conversationId };
    } catch (error) {
        console.error('Failed to apply to role:', error);
        return { success: false, error: 'Failed to submit application' };
    }
}

// ============================================================================
// ACCEPT APPLICATION ACTION (Creator only)
// ============================================================================
export async function acceptApplicationAction(
    applicationId: string,
    message?: string
): Promise<ApplicationResult> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, error: 'Unauthorized' };
        }

        const application = await db.query.roleApplications.findFirst({
            where: eq(roleApplications.id, applicationId),
            with: {
                // OPTIMIZATION: Include conversationId to avoid N+1 query in transaction
                project: { columns: { id: true, title: true, slug: true, ownerId: true, conversationId: true } },
                role: { columns: { id: true, role: true, title: true, filled: true, count: true } }
            }
        });

        if (!application) {
            return { success: false, error: 'Application not found' };
        }

        if (application.creatorId !== user.id) {
            return { success: false, error: 'Only the project owner can accept applications' };
        }

        if (application.status !== 'pending') {
            return { success: false, error: 'This application has already been processed' };
        }

        // Check if role is still available
        if (application.role && application.role.filled >= application.role.count) {
            return { success: false, error: 'This role is now full' };
        }

        // Transaction: accept app, add member, increment filled, auto-connect
        await db.transaction(async (tx) => {
            // 1. Update application status
            await tx.update(roleApplications)
                .set({ status: 'accepted', updatedAt: new Date() })
                .where(eq(roleApplications.id, applicationId));

            // 2. Add user as project member (use 'member' role for team membership)
            await tx.insert(projectMembers)
                .values({
                    projectId: application.projectId,
                    userId: application.applicantId,
                    role: 'member' // Member role for application-based joins
                })
                .onConflictDoNothing();

            // 3. Increment filled count on role
            await tx.update(projectOpenRoles)
                .set({
                    filled: sql`${projectOpenRoles.filled} + 1`,
                    updatedAt: new Date()
                })
                .where(eq(projectOpenRoles.id, application.roleId));

            // 3.5 Add new member to Project Group Conversation (Data Fencing)
            // OPTIMIZED: Use pre-fetched conversationId (no extra query)
            if (application.project?.conversationId) {
                await tx.insert(conversationParticipants)
                    .values({
                        conversationId: application.project.conversationId,
                        userId: application.applicantId,
                    })
                    .onConflictDoNothing();
            }

            // 4. Auto-connect users (if not already connected)
            const existingConnection = await tx.query.connections.findFirst({
                where: sql`
                    (${connections.requesterId} = ${user.id} AND ${connections.addresseeId} = ${application.applicantId})
                    OR 
                    (${connections.requesterId} = ${application.applicantId} AND ${connections.addresseeId} = ${user.id})
                `
            });

            if (!existingConnection) {
                await tx.insert(connections)
                    .values({
                        requesterId: user.id,
                        addresseeId: application.applicantId,
                        status: 'accepted'
                    })
                    .onConflictDoNothing();
            } else if (existingConnection.status !== 'accepted') {
                await tx.update(connections)
                    .set({ status: 'accepted', updatedAt: new Date() })
                    .where(eq(connections.id, existingConnection.id));
            }

            // Send status update message to chat if conversation exists
            if (application.conversationId) {
                // 1. UPDATE ORIGINAL APPLICATION MESSAGE (For Smart Banner)
                await tx.execute(sql`
                    UPDATE ${messages}
                    SET metadata = jsonb_set(metadata, '{status}', '"accepted"')
                    WHERE conversation_id = ${application.conversationId}
                    AND metadata->>'applicationId' = ${applicationId}
                `);

                // 2. SEND NEW NOTIFICATION MESSAGE
                await sendApplicationStatusUpdateInternal(
                    tx,
                    application.conversationId,
                    user.id,
                    applicationId,
                    application.projectId,
                    application.roleId,
                    application.project?.title || 'Project',
                    application.role?.title || application.role?.role || 'Role',
                    'accepted',
                    message
                );
            }
        });

        // LAZY PROJECT GROUP CREATION: For old projects without conversationId
        // After transaction (member is already in projectMembers), trigger group creation
        // ensureProjectGroupExists will include ALL current members including the new one
        if (!application.project?.conversationId && application.project?.ownerId) {
            ensureProjectGroupExists(application.projectId, application.project.ownerId).catch(() => { });
        }

        const slugOrId = application.project?.slug || application.projectId;
        revalidatePath(`/projects/${slugOrId}`);
        revalidatePath('/connections');
        revalidatePath('/messages');

        return { success: true };
    } catch (error) {
        console.error('Failed to accept application:', error);
        return { success: false, error: 'Failed to accept application' };
    }
}

// ============================================================================
// REJECT APPLICATION ACTION (Creator only)
// ============================================================================
export async function rejectApplicationAction(
    applicationId: string,
    message?: string,
    reason?: string
): Promise<ApplicationResult> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, error: 'Unauthorized' };
        }

        const application = await db.query.roleApplications.findFirst({
            where: eq(roleApplications.id, applicationId),
            with: {
                project: { columns: { title: true, slug: true } },
                role: { columns: { title: true, role: true } }
            },
            columns: { id: true, creatorId: true, projectId: true, roleId: true, status: true, conversationId: true }
        });

        if (!application) {
            return { success: false, error: 'Application not found' };
        }

        if (application.creatorId !== user.id) {
            return { success: false, error: 'Only the project owner can reject applications' };
        }

        if (application.status !== 'pending') {
            return { success: false, error: 'This application has already been processed' };
        }

        await db.transaction(async (tx) => {
            await tx.update(roleApplications)
                .set({ status: 'rejected', updatedAt: new Date() })
                .where(eq(roleApplications.id, applicationId));

            // Send status update message to chat if conversation exists
            if (application.conversationId) {
                // 1. UPDATE ORIGINAL APPLICATION MESSAGE (For Smart Banner)
                await tx.execute(sql`
                    UPDATE ${messages}
                    SET metadata = jsonb_set(metadata, '{status}', '"rejected"')
                    WHERE conversation_id = ${application.conversationId}
                    AND metadata->>'applicationId' = ${applicationId}
                `);

                // 2. SEND NEW NOTIFICATION MESSAGE
                await sendApplicationStatusUpdateInternal(
                    tx,
                    application.conversationId,
                    user.id,
                    applicationId,
                    application.projectId,
                    application.roleId,
                    application.project?.title || 'Project',
                    application.role?.title || application.role?.role || 'Role',
                    'rejected',
                    message,
                    reason
                );
            }
        });

        const slugOrId = application.project?.slug || application.projectId;
        revalidatePath(`/projects/${slugOrId}`);
        revalidatePath('/connections');
        revalidatePath('/messages');

        return { success: true };
    } catch (error) {
        console.error('Failed to reject application:', error);
        return { success: false, error: 'Failed to reject application' };
    }
}

// ============================================================================
// GET USER'S APPLICATIONS (for Connections > Requests tab)
// ============================================================================
export async function getMyApplicationsAction() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, applications: [] };
        }

        const applications = await db.query.roleApplications.findMany({
            where: eq(roleApplications.applicantId, user.id),
            with: {
                project: {
                    columns: { id: true, title: true, slug: true, coverImage: true }
                },
                role: {
                    columns: { role: true, title: true }
                }
            },
            orderBy: (apps, { desc }) => [desc(apps.createdAt)]
        });

        return {
            success: true,
            applications: applications.map(app => ({
                id: app.id,
                projectId: app.projectId,
                projectTitle: app.project?.title || 'Unknown Project',
                projectSlug: app.project?.slug,
                projectCover: app.project?.coverImage,
                roleTitle: app.role?.title || app.role?.role || 'Unknown Role',
                status: app.status,
                createdAt: app.createdAt,
                updatedAt: app.updatedAt,
                ...(app.status === 'rejected' ? calculateCooldown(app.updatedAt) : {})
            }))
        };
    } catch (error) {
        console.error('Failed to get applications:', error);
        return { success: false, applications: [] };
    }
}

// ============================================================================
// GET INCOMING APPLICATIONS (for Creator - Connections > Requests tab)
// ============================================================================
// ============================================================================
// GET INCOMING APPLICATIONS (for Creator - Connections > Requests tab)
// ============================================================================
export async function getIncomingApplicationsAction(
    limit: number = 20,
    offset: number = 0
) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, applications: [], hasMore: false };
        }

        const applications = await db.query.roleApplications.findMany({
            where: and(
                eq(roleApplications.creatorId, user.id),
                eq(roleApplications.status, 'pending')
            ),
            with: {
                project: {
                    columns: { id: true, title: true, slug: true }
                },
                role: {
                    columns: { role: true, title: true }
                },
                applicant: {
                    columns: { id: true, username: true, fullName: true, avatarUrl: true }
                }
            },
            columns: { id: true, projectId: true, status: true, createdAt: true, conversationId: true },
            orderBy: (apps, { desc }) => [desc(apps.createdAt)],
            limit: limit + 1,
            offset: offset
        });

        const hasMore = applications.length > limit;
        const slicedApplications = applications.slice(0, limit);

        return {
            success: true,
            applications: slicedApplications.map(app => ({
                id: app.id,
                projectId: app.projectId,
                projectTitle: app.project?.title || 'Unknown Project',
                projectSlug: app.project?.slug,
                roleTitle: app.role?.title || app.role?.role || 'Unknown Role',
                applicant: {
                    id: app.applicant?.id,
                    username: app.applicant?.username,
                    fullName: app.applicant?.fullName,
                    avatarUrl: app.applicant?.avatarUrl
                },
                status: app.status,
                createdAt: app.createdAt,
                conversationId: app.conversationId,
            })),
            hasMore
        };
    } catch (error) {
        console.error('Failed to get incoming applications:', error);
        return { success: false, applications: [], hasMore: false };
    }
}

// ============================================================================
// GET INBOX APPLICATIONS (Unified Incoming + Outgoing)
// ============================================================================
export async function getInboxApplicationsAction(
    limit: number = 20,
    offset: number = 0
) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, applications: [], hasMore: false };
        }

        // Fetch applications where:
        // 1. User is Creator AND status is 'pending' (Incoming)
        // 2. User is Applicant (Outgoing - see all active)
        const applications = await db.query.roleApplications.findMany({
            where: or(
                and(
                    eq(roleApplications.creatorId, user.id),
                    eq(roleApplications.status, 'pending')
                ),
                eq(roleApplications.applicantId, user.id)
            ),
            with: {
                project: {
                    columns: { id: true, title: true, slug: true, ownerId: true }
                },
                role: {
                    columns: { role: true, title: true }
                },
                applicant: {
                    columns: { id: true, username: true, fullName: true, avatarUrl: true }
                }
            },
            columns: { id: true, projectId: true, creatorId: true, applicantId: true, status: true, createdAt: true, conversationId: true },
            orderBy: (apps, { desc }) => [desc(apps.createdAt)],
            limit: limit + 1,
            offset: offset
        });

        const hasMore = applications.length > limit;
        const slicedApplications = applications.slice(0, limit);

        // Fetch creator profiles for outgoing applications
        // We need to fetch profiles for creators of projects we applied to
        const creatorIds = slicedApplications
            .filter(app => app.applicantId === user.id) // Outgoing
            .map(app => app.project?.ownerId || app.creatorId)
            .filter(Boolean) as string[];

        const uniqueCreatorIds = [...new Set(creatorIds)];

        let creatorsMap = new Map<string, { fullName: string | null; username: string | null; avatarUrl: string | null }>();

        if (uniqueCreatorIds.length > 0) {
            const creators = await db.query.profiles.findMany({
                where: inArray(profiles.id, uniqueCreatorIds),
                columns: { id: true, fullName: true, username: true, avatarUrl: true }
            });
            creatorsMap = new Map(creators.map(c => [c.id, c]));
        }

        return {
            success: true,
            applications: slicedApplications.map(app => {
                const isIncoming = app.creatorId === user.id;

                // Determine the "Other User" to display
                // Incoming: Show Applicant
                // Outgoing: Show Project Owner
                let displayUser;

                if (isIncoming) {
                    displayUser = {
                        id: app.applicant?.id,
                        username: app.applicant?.username,
                        fullName: app.applicant?.fullName,
                        avatarUrl: app.applicant?.avatarUrl,
                        type: 'applicant'
                    };
                } else {
                    const creatorId = app.project?.ownerId || app.creatorId;
                    const creator = creatorsMap.get(creatorId);
                    displayUser = {
                        id: creatorId,
                        username: creator?.username,
                        fullName: creator?.fullName,
                        avatarUrl: creator?.avatarUrl,
                        type: 'creator'
                    };
                }

                return {
                    id: app.id,
                    type: isIncoming ? 'incoming' : 'outgoing',
                    projectId: app.projectId,
                    projectTitle: app.project?.title || 'Unknown Project',
                    projectSlug: app.project?.slug,
                    roleTitle: app.role?.title || app.role?.role || 'Unknown Role',
                    displayUser,
                    status: app.status,
                    createdAt: app.createdAt,
                    conversationId: app.conversationId,
                };
            }),
            hasMore
        };
    } catch (error) {
        console.error('Failed to get inbox applications:', error);
        return { success: false, applications: [], hasMore: false };
    }
}
