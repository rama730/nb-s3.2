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
import { eq, and, sql, or, inArray, desc, lt } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { trackApplicationEvent } from '@/lib/observability/applications';
import { runInFlightDeduped } from '@/lib/async/inflight-dedupe';
import {
    APPLICATION_DECISION_REASON_TEMPLATES,
    normalizeApplicationDecisionReason,
    type ApplicationDecisionReasonCode,
} from '@/lib/applications/reasons';
import {
    calculateCooldown,
    normalizeApplicationMessageText,
    resolveLifecycleStatus,
} from '@/lib/applications/utils';
import { isApplicationReviewerRole } from '@/lib/applications/authorization';
import type {
    ApplicationActionOptions,
    ApplicationActionResult,
    ApplicationCursorPaginationInput,
    ApplicationRequestHistoryItem,
    ApplicationStatusResult,
    ApplicationActionErrorCode,
} from './types';
import { refreshWorkspaceCountersForUsers } from '@/lib/workspace/profile-counters';

// ============================================================================
// TYPES
// ============================================================================
type ApplicationDecisionStatus = 'accepted' | 'rejected';

// ============================================================================
// COOLDOWN HELPER (24 hours)
// ============================================================================
const APPLICATION_EDIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const APPLICATION_REOPEN_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const APPLICATION_PENDING_CAP_PER_USER = 20;
const APPLICATION_APPLY_COOLDOWN_PER_PROJECT_SECONDS = 60;
const APPLICATION_APPLY_COOLDOWN_GLOBAL_SECONDS = 8;
const APPLICATION_LIST_DEFAULT_LIMIT = 20;
const APPLICATION_LIST_MAX_LIMIT = 100;
const APPLICATION_LIST_MAX_OFFSET = 100_000;

function normalizeApplicationListPagination(limit: unknown, offset: unknown) {
    const rawLimit = typeof limit === 'number' ? limit : Number(limit);
    const normalizedLimit = Number.isFinite(rawLimit)
        ? Math.trunc(rawLimit)
        : APPLICATION_LIST_DEFAULT_LIMIT;
    const safeLimit = Math.min(Math.max(normalizedLimit, 1), APPLICATION_LIST_MAX_LIMIT);

    const rawOffset = typeof offset === 'number' ? offset : Number(offset);
    const normalizedOffset = Number.isFinite(rawOffset)
        ? Math.trunc(rawOffset)
        : 0;
    const safeOffset = Math.min(Math.max(normalizedOffset, 0), APPLICATION_LIST_MAX_OFFSET);

    return { safeLimit, safeOffset };
}

function normalizeCursorPaginationInput(
    input?: ApplicationCursorPaginationInput
): { safeLimit: number; cursor: { createdAt: Date; id: string } | null } {
    const rawLimit = typeof input?.limit === 'number' ? input.limit : Number(input?.limit);
    const normalizedLimit = Number.isFinite(rawLimit)
        ? Math.trunc(rawLimit)
        : APPLICATION_LIST_DEFAULT_LIMIT;
    const safeLimit = Math.min(Math.max(normalizedLimit, 1), APPLICATION_LIST_MAX_LIMIT);

    const rawCursor = typeof input?.cursor === 'string' ? input.cursor.trim() : '';
    if (!rawCursor) {
        return { safeLimit, cursor: null };
    }

    try {
        const decoded = Buffer.from(rawCursor, 'base64').toString('utf8');
        const [iso, id] = decoded.split(':::');
        if (!iso || !id) {
            return { safeLimit, cursor: null };
        }
        const createdAt = new Date(iso);
        if (Number.isNaN(createdAt.getTime())) {
            return { safeLimit, cursor: null };
        }
        return { safeLimit, cursor: { createdAt, id } };
    } catch {
        return { safeLimit, cursor: null };
    }
}

function encodeApplicationCursor(row: { createdAt: Date; id: string }): string {
    return Buffer.from(`${row.createdAt.toISOString()}:::${row.id}`, 'utf8').toString('base64');
}

function resolveApplicationTraceId(
    action: string,
    userId: string,
    targetId: string,
    options?: ApplicationActionOptions
): string {
    const supplied = options?.applicationTraceId?.trim();
    if (supplied) return supplied;
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    return `app_${action}_${userId.slice(0, 8)}_${targetId.slice(0, 8)}_${suffix}`;
}

function normalizeDecisionReasonCode(reason: unknown): ApplicationDecisionReasonCode {
    return normalizeApplicationDecisionReason(reason, 'other');
}

function toApplicationFailure(
    traceId: string,
    errorCode: ApplicationActionErrorCode,
    message: string
): ApplicationActionResult {
    return {
        success: false,
        error: message,
        errorCode,
        applicationTraceId: traceId,
    };
}

function toApplicationSuccess(
    traceId: string,
    payload?: Partial<ApplicationActionResult>
): ApplicationActionResult {
    return {
        success: true,
        applicationTraceId: traceId,
        ...payload,
    };
}


function buildApplicationMessageContent(projectTitle: string, roleTitle: string, normalizedMessage: string) {
    return `${projectTitle} / ${roleTitle}\n\n${normalizedMessage}`.trim();
}

function buildApplicationClientMessageId(applicationId: string) {
    return `application:${applicationId}`;
}

function buildApplicationDecisionClientMessageId(applicationId: string, status: ApplicationDecisionStatus) {
    return `application:decision:${applicationId}:${status}`;
}

function buildApplicationReopenClientMessageId(applicationId: string) {
    return `application:decision:${applicationId}:reopened`;
}

function appendTimelineEvent(
    metadata: Record<string, unknown> | null | undefined,
    event: Record<string, unknown>
) {
    const prev = metadata && typeof metadata === 'object' ? metadata : {};
    const timeline = Array.isArray((prev as any).timeline)
        ? ([...(prev as any).timeline] as Record<string, unknown>[])
        : [];
    timeline.push(event);
    return { ...prev, timeline };
}

function resolveDecisionMessage(
    status: ApplicationDecisionStatus,
    customMessage?: string,
    reason?: string
) {
    const trimmedCustom = (customMessage || '').trim();
    if (trimmedCustom) return trimmedCustom;
    if (status === 'accepted') {
        return 'Welcome to the project.';
    }
    const reasonKey = normalizeDecisionReasonCode(reason);
    return APPLICATION_DECISION_REASON_TEMPLATES[reasonKey];
}

function toISODate(value: Date | string | null | undefined) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function canReviewProjectApplicationInternal(
    txOrDb: typeof db | any,
    projectId: string,
    userId: string,
    ownerId?: string | null
) {
    if (ownerId && ownerId === userId) return true;
    const membership = await txOrDb.query.projectMembers.findFirst({
        where: and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)),
        columns: { role: true },
    });
    return isApplicationReviewerRole(membership?.role);
}

async function getDecisionMetadataMap(applicationIds: string[]) {
    const normalizedIds = Array.from(new Set(applicationIds.filter(Boolean)));
    if (normalizedIds.length === 0) {
        return new Map<string, { reasonCode: string | null; decisionAt: string | null }>();
    }

    const startedAtMs = Date.now();
    const CHUNK_SIZE = 200;
    const map = new Map<string, { reasonCode: string | null; decisionAt: string | null }>();

    for (let i = 0; i < normalizedIds.length; i += CHUNK_SIZE) {
        const chunk = normalizedIds.slice(i, i + CHUNK_SIZE);
        const rows = await db
            .select({
                applicationId: sql<string>`metadata->>'applicationId'`,
                reasonCode: sql<string | null>`metadata->>'reasonCode'`,
                decisionAt: sql<string | null>`metadata->>'decisionAt'`,
                createdAt: messages.createdAt,
            })
            .from(messages)
            .where(
                and(
                    eq(sql<string>`metadata->>'kind'`, 'application_decision'),
                    inArray(sql<string>`metadata->>'applicationId'`, chunk),
                ),
            )
            .orderBy(desc(messages.createdAt));

        for (const row of rows) {
            const applicationId = typeof row.applicationId === 'string' ? row.applicationId : null;
            if (!applicationId || map.has(applicationId)) continue;
            map.set(applicationId, {
                reasonCode: typeof row.reasonCode === 'string' ? row.reasonCode : null,
                decisionAt: typeof row.decisionAt === 'string' ? row.decisionAt : null,
            });
        }
    }

    const elapsedMs = Date.now() - startedAtMs;
    if (elapsedMs > 250) {
        console.info('[applications] getDecisionMetadataMap slow-path', {
            count: normalizedIds.length,
            elapsedMs,
        });
    }
    return map;
}

function isMissingApplicationDecisionColumn(error: unknown): boolean {
    const msg = error instanceof Error ? error.message : String(error);
    const lowered = msg.toLowerCase();
    return (
        lowered.includes('accepted_role_title') ||
        lowered.includes('decision_at') ||
        lowered.includes('decision_by')
    ) && lowered.includes('column');
}

function sortConnectionPair(a: string, b: string): [string, string] {
    return a < b ? [a, b] : [b, a];
}

async function applyConnectionsCountDelta(tx: any, userIds: string[], delta: number) {
    if (userIds.length === 0 || delta === 0) return;
    await tx
        .update(profiles)
        .set({
            connectionsCount: sql`GREATEST(0, ${profiles.connectionsCount} + ${delta})`,
            updatedAt: new Date(),
        })
        .where(inArray(profiles.id, userIds));
}

async function ensureAcceptedConnectionInternal(tx: any, userA: string, userB: string) {
    const [low, high] = sortConnectionPair(userA, userB);
    await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
            hashtext(CAST(${low} AS text)),
            hashtext(CAST(${high} AS text))
        )
    `);

    const existing = await tx
        .select({
            id: connections.id,
            status: connections.status,
        })
        .from(connections)
        .where(
            or(
                and(eq(connections.requesterId, userA), eq(connections.addresseeId, userB)),
                and(eq(connections.requesterId, userB), eq(connections.addresseeId, userA))
            )
        )
        .orderBy(desc(connections.updatedAt))
        .limit(1);

    if (existing.length > 0) {
        const row = existing[0];
        if (row.status === 'accepted') return;
        if (row.status === 'blocked') return;

        await tx
            .update(connections)
            .set({ status: 'accepted', updatedAt: new Date() })
            .where(eq(connections.id, row.id));

        await applyConnectionsCountDelta(tx, [userA, userB], 1);
        if (row.status === 'pending') {
            await refreshWorkspaceCountersForUsers(tx, [userA, userB]);
        }
        return;
    }

    await tx.insert(connections).values({
        requesterId: userA,
        addresseeId: userB,
        status: 'accepted',
    });

    await applyConnectionsCountDelta(tx, [userA, userB], 1);
}

async function ensureProjectGroupConversationIdInternal(
    tx: any,
    projectId: string,
    ownerId: string
): Promise<string> {
    const locked = await tx.execute(sql`
        SELECT conversation_id
        FROM ${projects}
        WHERE id = ${projectId}
        FOR UPDATE
    `);
    const row = Array.from(locked)[0] as { conversation_id: string | null } | undefined;
    if (row?.conversation_id) {
        return row.conversation_id;
    }

    const [conversation] = await tx
        .insert(conversations)
        .values({ type: 'project_group' })
        .returning({ id: conversations.id });

    await tx
        .update(projects)
        .set({ conversationId: conversation.id, updatedAt: new Date() })
        .where(eq(projects.id, projectId));

    const members = await tx
        .select({ userId: projectMembers.userId })
        .from(projectMembers)
        .where(eq(projectMembers.projectId, projectId));

    const participantIds = new Set<string>([ownerId]);
    members.forEach((member: { userId: string }) => participantIds.add(member.userId));

    await tx
        .insert(conversationParticipants)
        .values(
            Array.from(participantIds).map((userId) => ({
                conversationId: conversation.id,
                userId,
            }))
        )
        .onConflictDoNothing({
            target: [conversationParticipants.conversationId, conversationParticipants.userId],
        });

    return conversation.id;
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
    applicationId: string,
    applicationTraceId: string
): Promise<{ conversationId: string }> {
    // 1) Ensure a single DM conversation for this user pair
    const conversationId = await getOrCreateDmConversationIdInternal(tx, applicantId, creatorId);
    const clientMessageId = buildApplicationClientMessageId(applicationId);
    const normalizedMessage = normalizeApplicationMessageText(userMessage);
    const applicationMessage = buildApplicationMessageContent(projectTitle, roleTitle, normalizedMessage);
    const nowIso = new Date().toISOString();

    const [existingByClientId] = await tx
        .select({ id: messages.id, metadata: messages.metadata })
        .from(messages)
        .where(
            and(
                eq(messages.conversationId, conversationId),
                eq(messages.senderId, applicantId),
                eq(messages.clientMessageId, clientMessageId)
            )
        )
        .limit(1);

    const [legacyApplicationMessage] = existingByClientId
        ? [null]
        : await tx.execute(sql`
            SELECT id, metadata
            FROM ${messages}
            WHERE conversation_id = ${conversationId}
              AND sender_id = ${applicantId}
              AND deleted_at IS NULL
              AND metadata->>'kind' = 'application'
              AND metadata->>'applicationId' = ${applicationId}
            ORDER BY created_at DESC
            LIMIT 1
        `);

    const existingMessage = existingByClientId || legacyApplicationMessage || null;
    const baseMetadata = {
        kind: 'application',
        isApplication: true,
        eventVersion: 2,
        applicationId,
        projectId,
        roleId,
        projectTitle,
        roleTitle,
        status: 'pending',
        applicationTraceId,
        lastUpdatedAt: nowIso,
        links: normalizedMessage
            .split(/\r?\n/)
            .filter((line) => /: https?:\/\//i.test(line))
            .slice(0, 4),
    } as Record<string, unknown>;

    const nextMetadata = appendTimelineEvent(existingMessage?.metadata as Record<string, unknown> | undefined, {
        type: existingMessage ? 'updated' : 'submitted',
        status: 'pending',
        at: nowIso,
        by: applicantId,
        applicationTraceId,
    });

    const mergedMetadata = {
        ...nextMetadata,
        ...baseMetadata,
    };

    if (existingMessage?.id) {
        await tx
            .update(messages)
            .set({
                content: applicationMessage,
                metadata: mergedMetadata,
                clientMessageId,
                editedAt: new Date(),
                deletedAt: null,
            })
            .where(eq(messages.id, existingMessage.id))
            .returning({ id: messages.id });
    } else {
        const inserted = await tx
            .insert(messages)
            .values({
                conversationId,
                senderId: applicantId,
                clientMessageId,
                content: applicationMessage,
                type: 'text',
                metadata: mergedMetadata,
            })
            .onConflictDoUpdate({
                target: [messages.conversationId, messages.senderId, messages.clientMessageId],
                set: {
                    content: applicationMessage,
                    metadata: mergedMetadata,
                    editedAt: new Date(),
                    deletedAt: null,
                },
            })
            .returning({ id: messages.id });
        const insertedId = inserted[0]?.id;
        if (!insertedId) {
            throw new Error(
                `Message insert returned no id: conversationId=${conversationId}, applicationId=${applicationId}`
            );
        }
    }

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
async function sendApplicationStatusUpdateInternal(
    tx: any,
    conversationId: string,
    creatorId: string,
    applicationId: string,
    projectId: string,
    roleId: string,
    projectTitle: string,
    roleTitle: string,
    status: 'accepted' | 'rejected' | 'pending',
    customMessage?: string,
    reason?: string,
    applicationTraceId?: string
): Promise<void> {
    const statusText =
        status === 'accepted' ? 'Accepted' : status === 'rejected' ? 'Not Accepted' : 'Reopened';
    const messageText = `Application ${statusText}`;
    const decisionAt = new Date().toISOString();
    const resolvedMessage =
        status === 'pending'
            ? (customMessage || '').trim() || 'Application reopened for review.'
            : resolveDecisionMessage(status, customMessage, reason);
    const clientMessageId =
        status === 'pending'
            ? buildApplicationReopenClientMessageId(applicationId)
            : buildApplicationDecisionClientMessageId(applicationId, status);
    const decisionMetadata = {
        kind: 'application_update',
        isApplicationUpdate: true,
        eventVersion: 2,
        applicationId,
        projectId,
        roleId,
        projectTitle,
        roleTitle,
        status,
        applicationTraceId: applicationTraceId || null,
        ...(status === 'pending'
            ? { reopenedAt: decisionAt, reopenedBy: creatorId }
            : { decisionAt, decisionBy: creatorId }),
        reasonCode: reason || null,
        customMessage: resolvedMessage,
    };

    await tx
        .insert(messages)
        .values({
            conversationId,
            senderId: creatorId,
            clientMessageId,
            content: messageText,
            type: 'system',
            metadata: decisionMetadata,
        })
        .onConflictDoUpdate({
            target: [messages.conversationId, messages.senderId, messages.clientMessageId],
            set: {
                content: messageText,
                metadata: decisionMetadata,
                editedAt: new Date(),
            },
        });

    // Update conversation timestamp
    await tx
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, conversationId));
}

async function transitionApplicationDecisionInternal(
    tx: any,
    params: {
        applicationId: string;
        status: ApplicationDecisionStatus;
        decisionBy: string;
        acceptedRoleTitle?: string | null;
    }
) {
    const { applicationId, status, decisionBy, acceptedRoleTitle } = params;
    const now = new Date();

    const decisionSetWithMeta = {
        status,
        updatedAt: now,
        decisionAt: now,
        decisionBy,
        acceptedRoleTitle: status === 'accepted' ? acceptedRoleTitle || null : null,
    };

    try {
        const transitioned = await tx
            .update(roleApplications)
            .set(decisionSetWithMeta)
            .where(and(eq(roleApplications.id, applicationId), eq(roleApplications.status, 'pending')))
            .returning({ id: roleApplications.id });
        return transitioned.length > 0;
    } catch (error) {
        if (!isMissingApplicationDecisionColumn(error)) throw error;
        const transitioned = await tx
            .update(roleApplications)
            .set({
                status,
                updatedAt: now,
            })
            .where(and(eq(roleApplications.id, applicationId), eq(roleApplications.status, 'pending')))
            .returning({ id: roleApplications.id });
        return transitioned.length > 0;
    }
}

async function transitionApplicationToPendingInternal(
    tx: any,
    applicationId: string
) {
    const now = new Date();
    const transitioned = await tx
        .update(roleApplications)
        .set({
            status: 'pending',
            updatedAt: now,
            decisionAt: null,
            decisionBy: null,
            acceptedRoleTitle: null,
        })
        .where(and(eq(roleApplications.id, applicationId), eq(roleApplications.status, 'rejected')))
        .returning({ id: roleApplications.id });

    return transitioned.length > 0;
}

async function syncCanonicalApplicationMessageDecisionInternal(
    tx: any,
    params: {
        applicationId: string;
        conversationId: string | null;
        status: ApplicationDecisionStatus | 'pending';
        decisionBy: string;
        reason?: string;
        timelineType?: 'decision' | 'reopened';
        applicationTraceId?: string;
    }
) {
    const {
        applicationId,
        conversationId,
        status,
        decisionBy,
        reason,
        timelineType,
        applicationTraceId,
    } = params;
    if (!conversationId) return;

    const nowIso = new Date().toISOString();
    const updated = await tx.execute(sql`
        UPDATE ${messages}
        SET metadata = jsonb_set(
            jsonb_set(
                COALESCE(metadata, '{}'::jsonb),
                '{status}',
                to_jsonb(${status}::text)
            ),
            '{eventVersion}',
            '2'::jsonb
        )
        WHERE conversation_id = ${conversationId}
          AND deleted_at IS NULL
          AND metadata->>'kind' = 'application'
          AND metadata->>'applicationId' = ${applicationId}
        RETURNING id, metadata
    `);

    if (updated.length > 0) {
        const message = updated[0];
        const nextMetadata = appendTimelineEvent(message.metadata, {
            type: timelineType || (status === 'pending' ? 'reopened' : 'decision'),
            status,
            at: nowIso,
            by: decisionBy,
            reasonCode: reason || null,
            applicationTraceId: applicationTraceId || null,
        });

        await tx
            .update(messages)
            .set({
                metadata: {
                    ...nextMetadata,
                    status,
                    applicationTraceId: applicationTraceId || null,
                    ...(status === 'pending'
                        ? { reopenedBy: decisionBy, reopenedAt: nowIso }
                        : { decisionBy, decisionAt: nowIso }),
                    eventVersion: 2,
                },
                editedAt: new Date(),
            })
            .where(eq(messages.id, message.id));
    }
}

// ============================================================================
// GET APPLICATION STATUS (for project page)
// ============================================================================
export async function getApplicationStatusAction(projectId: string): Promise<ApplicationStatusResult> {
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
            columns: { id: true, status: true, roleId: true, updatedAt: true, decisionBy: true }
        });

        if (!application) {
            return { status: 'none' };
        }

        const roleTitle = application.role?.title || application.role?.role || 'Unknown Role';
        const decisionMap = await getDecisionMetadataMap([application.id]);
        const decisionReasonRaw = decisionMap.get(application.id)?.reasonCode || null;
        const decisionReason = decisionReasonRaw
            ? normalizeApplicationDecisionReason(decisionReasonRaw, 'other')
            : null;
        const lifecycleStatus = resolveLifecycleStatus(application.status, decisionReason);

        if (application.status === 'rejected') {
            if (application.decisionBy === user.id) {
                return {
                    status: 'rejected',
                    roleId: application.roleId,
                    roleTitle,
                    decisionReason,
                    lifecycleStatus,
                    canReapply: true,
                    updatedAt: application.updatedAt,
                };
            }
            const { canApply, waitTime } = calculateCooldown(application.updatedAt);
            return {
                status: 'rejected',
                roleId: application.roleId,
                roleTitle,
                decisionReason,
                lifecycleStatus,
                canReapply: canApply,
                waitTime,
                updatedAt: application.updatedAt
            };
        }

        return {
            status: application.status as 'pending' | 'accepted',
            roleId: application.roleId,
            roleTitle,
            decisionReason,
            lifecycleStatus,
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
    message: string,
    options?: ApplicationActionOptions
): Promise<ApplicationActionResult> {
    const traceId = resolveApplicationTraceId('apply', 'anon', projectId, options);
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return toApplicationFailure(traceId, 'UNAUTHORIZED', 'You must be logged in to apply');
        }

        const trimmedMessage = normalizeApplicationMessageText(message);
        if (!trimmedMessage) {
            return toApplicationFailure(traceId, 'INVALID_INPUT', 'Please add a short application message');
        }
        const dedupeKey = `applications:apply:${user.id}:${projectId}:${roleId}:${options?.idempotencyKey?.trim() || trimmedMessage.slice(0, 120)}`;
        return await runInFlightDeduped(dedupeKey, async () => {
            const applyRate = await consumeRateLimit(`applications:apply:${user.id}`, 30, APPLICATION_APPLY_COOLDOWN_GLOBAL_SECONDS);
            if (!applyRate.allowed) {
                return toApplicationFailure(traceId, 'RATE_LIMITED', 'Too many application attempts. Please wait a moment.');
            }
            const projectApplyRate = await consumeRateLimit(
                `applications:apply:${user.id}:${projectId}`,
                6,
                APPLICATION_APPLY_COOLDOWN_PER_PROJECT_SECONDS
            );
            if (!projectApplyRate.allowed) {
                return toApplicationFailure(traceId, 'RATE_LIMITED', 'Too many attempts for this project. Please retry shortly.');
            }

            const [project, role, existingMember, existingApp] = await Promise.all([
                db.query.projects.findFirst({
                    where: eq(projects.id, projectId),
                    columns: { id: true, ownerId: true, slug: true, title: true }
                }),
                db.query.projectOpenRoles.findFirst({
                    where: and(
                        eq(projectOpenRoles.id, roleId),
                        eq(projectOpenRoles.projectId, projectId)
                    ),
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
                    columns: { id: true, status: true, updatedAt: true, decisionBy: true, conversationId: true }
                })
            ]);

            if (!project) {
                return toApplicationFailure(traceId, 'PROJECT_NOT_FOUND', 'Project not found');
            }
            if (project.ownerId === user.id) {
                return toApplicationFailure(traceId, 'FORBIDDEN', 'You cannot apply to your own project');
            }
            if (!role) {
                return toApplicationFailure(traceId, 'ROLE_NOT_FOUND', 'Role not found');
            }
            if (role.filled >= role.count) {
                return toApplicationFailure(traceId, 'ROLE_FULL', 'This role has no available spots');
            }
            if (existingMember) {
                return toApplicationFailure(traceId, 'ALREADY_MEMBER', 'You are already a team member');
            }

            const roleTitleText = role?.title || role?.role || 'Unknown Role';

            if (existingApp) {
                if (existingApp.status === 'pending') {
                    return toApplicationSuccess(traceId, {
                        applicationId: existingApp.id,
                        conversationId: existingApp.conversationId || undefined,
                        idempotent: true,
                    });
                }
                if (existingApp.status === 'accepted') {
                    return toApplicationFailure(traceId, 'INVALID_STATE', 'Your application was already accepted');
                }
                if (existingApp.status === 'rejected') {
                    const canSkipCooldown = existingApp.decisionBy === user.id;
                    const { canApply, waitTime } = canSkipCooldown
                        ? { canApply: true, waitTime: undefined as string | undefined }
                        : calculateCooldown(existingApp.updatedAt);
                    if (!canApply) {
                        return toApplicationFailure(traceId, 'COOLDOWN_ACTIVE', `You can reapply in ${waitTime}`);
                    }

                    const { conversationId } = await db.transaction(async (tx) => {
                        const reopened = await transitionApplicationToPendingInternal(tx, existingApp.id);
                        if (!reopened) {
                            throw new Error('Application is not eligible for reapply');
                        }

                        await tx
                            .update(roleApplications)
                            .set({
                                roleId,
                                message: trimmedMessage,
                                updatedAt: new Date(),
                            })
                            .where(eq(roleApplications.id, existingApp.id));

                        const { conversationId } = await sendApplicationMessageInternal(
                            tx,
                            user.id,
                            project.ownerId,
                            projectId,
                            roleId,
                            project.title || 'Project',
                            roleTitleText,
                            trimmedMessage,
                            existingApp.id,
                            traceId
                        );

                        await tx.update(roleApplications)
                            .set({ conversationId, updatedAt: new Date() })
                            .where(eq(roleApplications.id, existingApp.id));

                        return { conversationId };
                    });

                    revalidatePath(`/projects/${project.slug || projectId}`);
                    revalidatePath('/messages');
                    trackApplicationEvent('apply_submitted', {
                        applicationId: existingApp.id,
                        projectId,
                        roleId,
                        actorId: user.id,
                        source: 'project',
                        applicationTraceId: traceId,
                    });
                    return toApplicationSuccess(traceId, {
                        applicationId: existingApp.id,
                        conversationId,
                        idempotent: true,
                    });
                }
            }

            const pendingCount = await db
                .select({ count: sql<number>`COUNT(*)::int` })
                .from(roleApplications)
                .where(and(eq(roleApplications.applicantId, user.id), eq(roleApplications.status, 'pending')))
                .then((rows) => rows[0]?.count ?? 0);
            if (pendingCount >= APPLICATION_PENDING_CAP_PER_USER) {
                return toApplicationFailure(traceId, 'INVALID_STATE', 'You already have too many pending applications. Please wait for decisions.');
            }

            const { applicationId: newApplicationId, conversationId } = await db.transaction(async (tx) => {
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

                const { conversationId } = await sendApplicationMessageInternal(
                    tx,
                    user.id,
                    project.ownerId,
                    projectId,
                    roleId,
                    project.title || 'Project',
                    roleTitleText,
                    trimmedMessage,
                    newApp.id,
                    traceId
                );

                await tx.update(roleApplications)
                    .set({ conversationId, updatedAt: new Date() })
                    .where(eq(roleApplications.id, newApp.id));

                return { applicationId: newApp.id, conversationId };
            });

            revalidatePath(`/projects/${project.slug || projectId}`);
            revalidatePath('/messages');
            revalidatePath('/people');
            trackApplicationEvent('apply_submitted', {
                applicationId: newApplicationId,
                projectId,
                roleId,
                actorId: user.id,
                source: 'project',
                applicationTraceId: traceId,
            });

            return toApplicationSuccess(traceId, {
                applicationId: newApplicationId,
                conversationId,
            });
        });
    } catch (error) {
        console.error('Failed to apply to role:', error);
        if (error instanceof Error && error.message === 'Application is not eligible for reapply') {
            return toApplicationFailure(traceId, 'INVALID_STATE', 'This application cannot be reopened right now');
        }
        return toApplicationFailure(traceId, 'INTERNAL_ERROR', 'Failed to submit application');
    }
}

// ============================================================================
// ACCEPT APPLICATION ACTION (Creator only)
// ============================================================================
export async function acceptApplicationAction(
    applicationId: string,
    message?: string,
    options?: ApplicationActionOptions
): Promise<ApplicationActionResult> {
    const traceId = resolveApplicationTraceId('accept', 'anon', applicationId, options);
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return toApplicationFailure(traceId, 'UNAUTHORIZED', 'Unauthorized');
        }
        const dedupeKey = `applications:accept:${user.id}:${applicationId}:${options?.idempotencyKey?.trim() || 'default'}`;
        return await runInFlightDeduped(dedupeKey, async () => {
            const acceptRate = await consumeRateLimit(`applications:accept:${user.id}`, 40, 60);
            if (!acceptRate.allowed) {
                return toApplicationFailure(traceId, 'RATE_LIMITED', 'Too many decisions. Please wait a moment.');
            }

            const application = await db.query.roleApplications.findFirst({
                where: eq(roleApplications.id, applicationId),
                with: {
                    project: { columns: { id: true, title: true, slug: true, ownerId: true, conversationId: true } },
                    role: { columns: { id: true, role: true, title: true, filled: true, count: true, projectId: true } }
                }
            });

            if (!application) {
                return toApplicationFailure(traceId, 'NOT_FOUND', 'Application not found');
            }

            const canReview = await canReviewProjectApplicationInternal(
                db,
                application.projectId,
                user.id,
                application.project?.ownerId
            );
            if (!canReview) {
                return toApplicationFailure(traceId, 'FORBIDDEN', 'Only the project owner or admins can accept applications');
            }

            if (application.status === 'accepted') {
                return toApplicationSuccess(traceId, { idempotent: true, applicationId });
            }
            if (application.status === 'rejected') {
                return toApplicationFailure(traceId, 'INVALID_STATE', 'This application has already been rejected');
            }

            if (!application.role || application.role.projectId !== application.projectId) {
                return toApplicationFailure(traceId, 'INVALID_STATE', 'Invalid application role mapping');
            }

            if (application.role && application.role.filled >= application.role.count) {
                return toApplicationFailure(traceId, 'ROLE_FULL', 'This role is now full');
            }

            await db.transaction(async (tx) => {
                const roleTitleForMember =
                    application.role?.title || application.role?.role || 'Team Member';

                const transitioned = await transitionApplicationDecisionInternal(tx, {
                    applicationId,
                    status: 'accepted',
                    decisionBy: user.id,
                    acceptedRoleTitle: roleTitleForMember,
                });

                if (!transitioned) {
                    throw new Error('Application already processed');
                }

                const existingMember = await tx.query.projectMembers.findFirst({
                    where: and(
                        eq(projectMembers.projectId, application.projectId),
                        eq(projectMembers.userId, application.applicantId)
                    ),
                    columns: { id: true }
                });

                if (!existingMember) {
                    const roleCapacity = await tx
                        .select({
                            id: projectOpenRoles.id,
                            filled: projectOpenRoles.filled,
                            count: projectOpenRoles.count,
                        })
                        .from(projectOpenRoles)
                        .where(eq(projectOpenRoles.id, application.roleId))
                        .for('update')
                        .limit(1);

                    const role = roleCapacity[0];
                    if (!role || role.filled >= role.count) {
                        throw new Error('Role is full');
                    }

                    await tx.insert(projectMembers)
                        .values({
                            projectId: application.projectId,
                            userId: application.applicantId,
                            role: 'member'
                        });

                    await tx.update(projectOpenRoles)
                        .set({
                            filled: sql`${projectOpenRoles.filled} + 1`,
                            updatedAt: new Date()
                        })
                        .where(eq(projectOpenRoles.id, application.roleId));
                }

                const projectConversationId = await ensureProjectGroupConversationIdInternal(
                    tx,
                    application.projectId,
                    application.project.ownerId
                );
                await tx
                    .insert(conversationParticipants)
                    .values([
                        { conversationId: projectConversationId, userId: application.project.ownerId },
                        { conversationId: projectConversationId, userId: application.applicantId },
                    ])
                    .onConflictDoNothing({
                        target: [conversationParticipants.conversationId, conversationParticipants.userId],
                    });

                await ensureAcceptedConnectionInternal(tx, user.id, application.applicantId);

                if (application.conversationId) {
                    await syncCanonicalApplicationMessageDecisionInternal(tx, {
                        applicationId,
                        conversationId: application.conversationId,
                        status: 'accepted',
                        decisionBy: user.id,
                        applicationTraceId: traceId,
                    });

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
                        message,
                        undefined,
                        traceId
                    );
                }
            });

            const slugOrId = application.project?.slug || application.projectId;
            revalidatePath(`/projects/${slugOrId}`);
            revalidatePath('/people');
            revalidatePath('/messages');
            trackApplicationEvent('apply_accepted', {
                applicationId,
                projectId: application.projectId,
                roleId: application.roleId,
                actorId: user.id,
                source: 'requests',
                applicationTraceId: traceId,
            });

            return toApplicationSuccess(traceId, { applicationId });
        });
    } catch (error) {
        console.error('Failed to accept application:', error);
        if (error instanceof Error && error.message === 'Application already processed') {
            return toApplicationFailure(traceId, 'ALREADY_PROCESSED', 'This application has already been processed');
        }
        if (error instanceof Error && error.message === 'Role is full') {
            return toApplicationFailure(traceId, 'ROLE_FULL', 'This role is now full');
        }
        return toApplicationFailure(traceId, 'INTERNAL_ERROR', 'Failed to accept application');
    }
}

// ============================================================================
// REJECT APPLICATION ACTION (Creator only)
// ============================================================================
export async function rejectApplicationAction(
    applicationId: string,
    message?: string,
    reason?: string,
    options?: ApplicationActionOptions
): Promise<ApplicationActionResult> {
    const traceId = resolveApplicationTraceId('reject', 'anon', applicationId, options);
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return toApplicationFailure(traceId, 'UNAUTHORIZED', 'Unauthorized');
        }
        const dedupeKey = `applications:reject:${user.id}:${applicationId}:${options?.idempotencyKey?.trim() || 'default'}`;
        return await runInFlightDeduped(dedupeKey, async () => {
            const rejectRate = await consumeRateLimit(`applications:reject:${user.id}`, 50, 60);
            if (!rejectRate.allowed) {
                return toApplicationFailure(traceId, 'RATE_LIMITED', 'Too many decisions. Please wait a moment.');
            }

            const application = await db.query.roleApplications.findFirst({
                where: eq(roleApplications.id, applicationId),
                with: {
                    project: { columns: { title: true, slug: true, ownerId: true } },
                    role: { columns: { title: true, role: true } }
                },
                columns: { id: true, creatorId: true, projectId: true, roleId: true, status: true, conversationId: true }
            });

            if (!application) {
                return toApplicationFailure(traceId, 'NOT_FOUND', 'Application not found');
            }

            const canReview = await canReviewProjectApplicationInternal(
                db,
                application.projectId,
                user.id,
                application.project?.ownerId || application.creatorId
            );
            if (!canReview) {
                return toApplicationFailure(traceId, 'FORBIDDEN', 'Only the project owner or admins can reject applications');
            }

            if (application.status === 'rejected') {
                return toApplicationSuccess(traceId, { idempotent: true, applicationId });
            }
            if (application.status === 'accepted') {
                return toApplicationFailure(traceId, 'INVALID_STATE', 'This application has already been accepted');
            }

            const normalizedReason = normalizeDecisionReasonCode(reason || 'other');

            await db.transaction(async (tx) => {
                const transitioned = await transitionApplicationDecisionInternal(tx, {
                    applicationId,
                    status: 'rejected',
                    decisionBy: user.id,
                });

                if (!transitioned) {
                    throw new Error('Application already processed');
                }

                if (application.conversationId) {
                    await syncCanonicalApplicationMessageDecisionInternal(tx, {
                        applicationId,
                        conversationId: application.conversationId,
                        status: 'rejected',
                        decisionBy: user.id,
                        reason: normalizedReason,
                        applicationTraceId: traceId,
                    });

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
                        normalizedReason,
                        traceId
                    );
                }
            });

            const slugOrId = application.project?.slug || application.projectId;
            revalidatePath(`/projects/${slugOrId}`);
            revalidatePath('/people');
            revalidatePath('/messages');
            trackApplicationEvent('apply_rejected', {
                applicationId,
                projectId: application.projectId,
                roleId: application.roleId,
                actorId: user.id,
                reasonCode: normalizedReason || null,
                source: 'requests',
                applicationTraceId: traceId,
            });

            return toApplicationSuccess(traceId, { applicationId });
        });
    } catch (error) {
        console.error('Failed to reject application:', error);
        if (error instanceof Error && error.message === 'Application already processed') {
            return toApplicationFailure(traceId, 'ALREADY_PROCESSED', 'This application has already been processed');
        }
        return toApplicationFailure(traceId, 'INTERNAL_ERROR', 'Failed to reject application');
    }
}

// ============================================================================
// EDIT PENDING APPLICATION (Applicant only, short window)
// ============================================================================
export async function editPendingApplicationAction(
    applicationId: string,
    message: string,
    options?: ApplicationActionOptions
): Promise<ApplicationActionResult> {
    const traceId = resolveApplicationTraceId('edit', 'anon', applicationId, options);
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return toApplicationFailure(traceId, 'UNAUTHORIZED', 'Unauthorized');
        }

        const editRate = await consumeRateLimit(`applications:edit:${user.id}`, 20, 60);
        if (!editRate.allowed) {
            return toApplicationFailure(traceId, 'RATE_LIMITED', 'Too many edits. Please wait a moment.');
        }

        const normalizedMessage = normalizeApplicationMessageText(message);
        if (!normalizedMessage) {
            return toApplicationFailure(traceId, 'INVALID_INPUT', 'Application message cannot be empty');
        }

        const application = await db.query.roleApplications.findFirst({
            where: eq(roleApplications.id, applicationId),
            with: {
                project: { columns: { id: true, title: true, slug: true, ownerId: true } },
                role: { columns: { id: true, role: true, title: true } },
            },
            columns: {
                id: true,
                applicantId: true,
                creatorId: true,
                projectId: true,
                roleId: true,
                status: true,
                message: true,
                createdAt: true,
                conversationId: true,
            },
        });

        if (!application) return toApplicationFailure(traceId, 'NOT_FOUND', 'Application not found');
        if (application.applicantId !== user.id) return toApplicationFailure(traceId, 'FORBIDDEN', 'Only the applicant can edit this application');
        if (application.status !== 'pending') return toApplicationFailure(traceId, 'INVALID_STATE', 'Only pending applications can be edited');

        const ageMs = Date.now() - new Date(application.createdAt).getTime();
        if (ageMs > APPLICATION_EDIT_WINDOW_MS) {
            return toApplicationFailure(traceId, 'EDIT_WINDOW_EXPIRED', 'Edit window expired');
        }

        if ((application.message || '').trim() === normalizedMessage) {
            return toApplicationSuccess(traceId, {
                applicationId: application.id,
                conversationId: application.conversationId || undefined,
                idempotent: true,
            });
        }

        const roleTitle = application.role?.title || application.role?.role || 'Role';
        const projectTitle = application.project?.title || 'Project';

        const { conversationId } = await db.transaction(async (tx) => {
            await tx
                .update(roleApplications)
                .set({ message: normalizedMessage, updatedAt: new Date() })
                .where(eq(roleApplications.id, application.id));

            const { conversationId } = await sendApplicationMessageInternal(
                tx,
                application.applicantId,
                application.creatorId,
                application.projectId,
                application.roleId,
                projectTitle,
                roleTitle,
                normalizedMessage,
                application.id,
                traceId
            );

            await tx
                .update(roleApplications)
                .set({ conversationId, updatedAt: new Date() })
                .where(eq(roleApplications.id, application.id));

            return { conversationId };
        });

        const slugOrId = application.project?.slug || application.projectId;
        revalidatePath(`/projects/${slugOrId}`);
        revalidatePath('/messages');
        revalidatePath('/people');
        trackApplicationEvent('apply_edited', {
            applicationId: application.id,
            projectId: application.projectId,
            roleId: application.roleId,
            actorId: user.id,
            source: 'messages',
            applicationTraceId: traceId,
        });

        return toApplicationSuccess(traceId, {
            applicationId: application.id,
            conversationId,
        });
    } catch (error) {
        console.error('Failed to edit pending application:', error);
        return toApplicationFailure(traceId, 'INTERNAL_ERROR', 'Failed to edit application');
    }
}

// ============================================================================
// WITHDRAW PENDING APPLICATION (Applicant only)
// ============================================================================
export async function withdrawApplicationAction(
    applicationId: string,
    message?: string,
    options?: ApplicationActionOptions
): Promise<ApplicationActionResult> {
    const traceId = resolveApplicationTraceId('withdraw', 'anon', applicationId, options);
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return toApplicationFailure(traceId, 'UNAUTHORIZED', 'Unauthorized');
        }

        const withdrawRate = await consumeRateLimit(`applications:withdraw:${user.id}`, 20, 60);
        if (!withdrawRate.allowed) {
            return toApplicationFailure(traceId, 'RATE_LIMITED', 'Too many requests. Please wait a moment.');
        }

        const application = await db.query.roleApplications.findFirst({
            where: eq(roleApplications.id, applicationId),
            with: {
                project: { columns: { title: true, slug: true } },
                role: { columns: { title: true, role: true } },
            },
            columns: {
                id: true,
                applicantId: true,
                projectId: true,
                roleId: true,
                status: true,
                conversationId: true,
            },
        });

        if (!application) return toApplicationFailure(traceId, 'NOT_FOUND', 'Application not found');
        if (application.applicantId !== user.id) return toApplicationFailure(traceId, 'FORBIDDEN', 'Only the applicant can withdraw this application');
        if (application.status === 'accepted') return toApplicationFailure(traceId, 'INVALID_STATE', 'Accepted applications cannot be withdrawn');
        if (application.status === 'rejected') {
            return toApplicationSuccess(traceId, { applicationId, idempotent: true });
        }

        await db.transaction(async (tx) => {
            const transitioned = await transitionApplicationDecisionInternal(tx, {
                applicationId,
                status: 'rejected',
                decisionBy: user.id,
            });

            if (!transitioned) {
                throw new Error('Application already processed');
            }

            await syncCanonicalApplicationMessageDecisionInternal(tx, {
                applicationId,
                conversationId: application.conversationId,
                status: 'rejected',
                decisionBy: user.id,
                reason: 'withdrawn_by_applicant',
                applicationTraceId: traceId,
            });

            if (application.conversationId) {
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
                    (message || '').trim() || 'Application withdrawn by applicant',
                    'withdrawn_by_applicant',
                    traceId
                );
            }
        });

        const slugOrId = application.project?.slug || application.projectId;
        revalidatePath(`/projects/${slugOrId}`);
        revalidatePath('/messages');
        revalidatePath('/people');
        trackApplicationEvent('apply_withdrawn', {
            applicationId,
            projectId: application.projectId,
            roleId: application.roleId,
            actorId: user.id,
            reasonCode: 'withdrawn_by_applicant',
            source: 'messages',
            applicationTraceId: traceId,
        });

        return toApplicationSuccess(traceId, { applicationId });
    } catch (error) {
        console.error('Failed to withdraw application:', error);
        if (error instanceof Error && error.message === 'Application already processed') {
            return toApplicationFailure(traceId, 'ALREADY_PROCESSED', 'This application has already been processed');
        }
        return toApplicationFailure(traceId, 'INTERNAL_ERROR', 'Failed to withdraw application');
    }
}

// ============================================================================
// REOPEN REJECTED APPLICATION (Reviewer only, short window)
// ============================================================================
export async function reopenApplicationAction(
    applicationId: string,
    message?: string,
    options?: ApplicationActionOptions
): Promise<ApplicationActionResult> {
    const traceId = resolveApplicationTraceId('reopen', 'anon', applicationId, options);
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return toApplicationFailure(traceId, 'UNAUTHORIZED', 'Unauthorized');
        }

        const reopenRate = await consumeRateLimit(`applications:reopen:${user.id}`, 20, 60);
        if (!reopenRate.allowed) {
            return toApplicationFailure(traceId, 'RATE_LIMITED', 'Too many reopen requests. Please wait a moment.');
        }

        const application = await db.query.roleApplications.findFirst({
            where: eq(roleApplications.id, applicationId),
            with: {
                project: { columns: { title: true, slug: true, ownerId: true } },
                role: { columns: { title: true, role: true } },
            },
            columns: {
                id: true,
                projectId: true,
                roleId: true,
                status: true,
                creatorId: true,
                conversationId: true,
                decisionAt: true,
                updatedAt: true,
            },
        });

        if (!application) return toApplicationFailure(traceId, 'NOT_FOUND', 'Application not found');

        const canReview = await canReviewProjectApplicationInternal(
            db,
            application.projectId,
            user.id,
            application.project?.ownerId || application.creatorId
        );
        if (!canReview) {
            return toApplicationFailure(traceId, 'FORBIDDEN', 'Only project owner or admins can reopen applications');
        }

        if (application.status === 'pending') {
            return toApplicationSuccess(traceId, { applicationId, idempotent: true });
        }
        if (application.status === 'accepted') {
            return toApplicationFailure(traceId, 'INVALID_STATE', 'Accepted applications cannot be reopened');
        }
        if (application.status !== 'rejected') {
            return toApplicationFailure(traceId, 'INVALID_STATE', 'Only rejected applications can be reopened');
        }

        const decisionTimestampSource = application.decisionAt ?? application.updatedAt;
        if (!decisionTimestampSource) {
            return toApplicationFailure(traceId, 'INVALID_STATE', 'Cannot determine decision timestamp');
        }
        const decisionTimestamp = new Date(decisionTimestampSource).getTime();
        if (Number.isNaN(decisionTimestamp)) {
            return toApplicationFailure(traceId, 'INVALID_STATE', 'Invalid decision timestamp');
        }
        if (Date.now() - decisionTimestamp > APPLICATION_REOPEN_WINDOW_MS) {
            return toApplicationFailure(traceId, 'REOPEN_WINDOW_EXPIRED', 'Reopen window expired');
        }

        await db.transaction(async (tx) => {
            const reopened = await transitionApplicationToPendingInternal(tx, applicationId);
            if (!reopened) throw new Error('Application already processed');

            await syncCanonicalApplicationMessageDecisionInternal(tx, {
                applicationId,
                conversationId: application.conversationId,
                status: 'pending',
                decisionBy: user.id,
                reason: 'reopened_by_reviewer',
                timelineType: 'reopened',
                applicationTraceId: traceId,
            });

            if (application.conversationId) {
                await sendApplicationStatusUpdateInternal(
                    tx,
                    application.conversationId,
                    user.id,
                    applicationId,
                    application.projectId,
                    application.roleId,
                    application.project?.title || 'Project',
                    application.role?.title || application.role?.role || 'Role',
                    'pending',
                    (message || '').trim() || 'Application reopened for review.',
                    'reopened_by_reviewer',
                    traceId
                );
            }
        });

        const slugOrId = application.project?.slug || application.projectId;
        revalidatePath(`/projects/${slugOrId}`);
        revalidatePath('/people');
        revalidatePath('/messages');
        trackApplicationEvent('apply_reopened', {
            applicationId,
            projectId: application.projectId,
            roleId: application.roleId,
            actorId: user.id,
            source: 'messages',
            applicationTraceId: traceId,
        });

        return toApplicationSuccess(traceId, { applicationId });
    } catch (error) {
        console.error('Failed to reopen application:', error);
        if (error instanceof Error && error.message === 'Application already processed') {
            return toApplicationFailure(traceId, 'ALREADY_PROCESSED', 'This application cannot be reopened right now');
        }
        return toApplicationFailure(traceId, 'INTERNAL_ERROR', 'Failed to reopen application');
    }
}

// ============================================================================
// GET USER'S APPLICATIONS (for Connections > Requests tab)
// ============================================================================
export async function getMyApplicationsAction(
    pagination: ApplicationCursorPaginationInput = {}
) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return {
                success: false,
                errorCode: 'UNAUTHORIZED' as const,
                error: 'Unauthorized',
                applications: [],
                hasMore: false,
                nextCursor: null,
            };
        }

        const { safeLimit, cursor } = normalizeCursorPaginationInput(pagination);

        const applications = await db.query.roleApplications.findMany({
            where: cursor
                ? and(
                    eq(roleApplications.applicantId, user.id),
                    or(
                        lt(roleApplications.createdAt, cursor.createdAt),
                        and(eq(roleApplications.createdAt, cursor.createdAt), lt(roleApplications.id, cursor.id))
                    )
                )
                : eq(roleApplications.applicantId, user.id),
            with: {
                project: {
                    columns: { id: true, title: true, slug: true, coverImage: true }
                },
                role: {
                    columns: { role: true, title: true }
                }
            },
            columns: {
                id: true,
                projectId: true,
                roleId: true,
                message: true,
                status: true,
                conversationId: true,
                createdAt: true,
                updatedAt: true,
                decisionBy: true,
            },
            orderBy: (apps, { desc }) => [desc(apps.createdAt), desc(apps.id)],
            limit: safeLimit + 1,
        });

        const hasMore = applications.length > safeLimit;
        const slicedApplications = applications.slice(0, safeLimit);
        const nextCursor = hasMore && slicedApplications.length > 0
            ? encodeApplicationCursor({
                createdAt: slicedApplications[slicedApplications.length - 1].createdAt,
                id: slicedApplications[slicedApplications.length - 1].id,
            })
            : null;

        const decisionMap = await getDecisionMetadataMap(slicedApplications.map((app) => app.id));

        return {
            success: true,
            applications: slicedApplications.map((app) => {
                const decisionMeta = decisionMap.get(app.id);
                const decisionReasonRaw = decisionMeta?.reasonCode || null;
                const decisionReason = decisionReasonRaw
                    ? normalizeApplicationDecisionReason(decisionReasonRaw, 'other')
                    : null;
                const lifecycleStatus = resolveLifecycleStatus(app.status, decisionReason);
                const canSkipCooldown = app.decisionBy === user.id;
                const cooldownMeta =
                    app.status === 'rejected'
                        ? (canSkipCooldown ? { canApply: true } : calculateCooldown(app.updatedAt))
                        : {};
                return {
                    id: app.id,
                    projectId: app.projectId,
                    projectTitle: app.project?.title || 'Unknown Project',
                    projectSlug: app.project?.slug,
                    projectCover: app.project?.coverImage,
                    roleTitle: app.role?.title || app.role?.role || 'Unknown Role',
                    message: app.message,
                    status: app.status,
                    lifecycleStatus,
                    decisionReason,
                    createdAt: app.createdAt,
                    updatedAt: app.updatedAt,
                    decisionAt: decisionMeta?.decisionAt || toISODate(app.updatedAt),
                    conversationId: app.conversationId,
                    canEdit:
                        app.status === 'pending' &&
                        Date.now() - new Date(app.createdAt).getTime() <= APPLICATION_EDIT_WINDOW_MS,
                    ...cooldownMeta
                };
            }),
            hasMore,
            nextCursor,
        };
    } catch (error) {
        console.error('Failed to get applications:', error);
        return {
            success: false,
            errorCode: 'INTERNAL_ERROR' as const,
            error: 'Failed to load applications',
            applications: [],
            hasMore: false,
            nextCursor: null,
        };
    }
}

// ============================================================================
// GET INCOMING APPLICATIONS (for Creator - Connections > Requests tab)
// ============================================================================
// ============================================================================
// GET INCOMING APPLICATIONS (for Creator - Connections > Requests tab)
// ============================================================================
export async function getIncomingApplicationsAction(
    paginationOrLimit: ApplicationCursorPaginationInput | number = APPLICATION_LIST_DEFAULT_LIMIT,
    offset: number = 0
) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return {
                success: false,
                errorCode: 'UNAUTHORIZED' as const,
                error: 'Unauthorized',
                applications: [],
                hasMore: false,
                nextCursor: null,
            };
        }

        const legacyMode = typeof paginationOrLimit === 'number';
        const { safeLimit, safeOffset } = legacyMode
            ? normalizeApplicationListPagination(paginationOrLimit, offset)
            : normalizeApplicationListPagination(paginationOrLimit.limit, 0);
        const { cursor } = legacyMode
            ? { cursor: null }
            : normalizeCursorPaginationInput(paginationOrLimit);

        const applications = await db.query.roleApplications.findMany({
            where: and(
                eq(roleApplications.creatorId, user.id),
                eq(roleApplications.status, 'pending'),
                ...(cursor
                    ? [or(
                        lt(roleApplications.createdAt, cursor.createdAt),
                        and(eq(roleApplications.createdAt, cursor.createdAt), lt(roleApplications.id, cursor.id))
                    )]
                    : [])
            ),
            with: {
                project: {
                    columns: { id: true, title: true, slug: true }
                },
                role: {
                    columns: { role: true, title: true }
                },
                applicant: {
                    columns: { id: true, username: true, fullName: true, avatarUrl: true, skills: true, headline: true }
                }
            },
            columns: { id: true, projectId: true, status: true, createdAt: true, conversationId: true },
            orderBy: (apps, { desc }) => [desc(apps.createdAt), desc(apps.id)],
            limit: safeLimit + 1,
            offset: cursor ? 0 : safeOffset
        });

        const hasMore = applications.length > safeLimit;
        const slicedApplications = applications.slice(0, safeLimit);
        const nextCursor = hasMore && slicedApplications.length > 0
            ? encodeApplicationCursor({
                createdAt: slicedApplications[slicedApplications.length - 1].createdAt,
                id: slicedApplications[slicedApplications.length - 1].id,
            })
            : null;

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
                    avatarUrl: app.applicant?.avatarUrl,
                    skills: app.applicant?.skills ?? [],
                    headline: app.applicant?.headline ?? null,
                },
                status: app.status,
                createdAt: app.createdAt,
                conversationId: app.conversationId,
            })),
            hasMore,
            nextCursor,
        };
    } catch (error) {
        console.error('Failed to get incoming applications:', error);
        return {
            success: false,
            errorCode: 'INTERNAL_ERROR' as const,
            error: 'Failed to load incoming applications',
            applications: [],
            hasMore: false,
            nextCursor: null,
        };
    }
}

// ============================================================================
// GET INBOX APPLICATIONS (Unified Incoming + Outgoing)
// ============================================================================
export async function getInboxApplicationsAction(
    limit: number = APPLICATION_LIST_DEFAULT_LIMIT,
    offset: number = 0
) {
    try {
        const startedAtMs = Date.now();
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, applications: [], hasMore: false };
        }
        const { safeLimit, safeOffset } = normalizeApplicationListPagination(limit, offset);

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
            columns: {
                id: true,
                projectId: true,
                creatorId: true,
                applicantId: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                conversationId: true,
            },
            orderBy: (apps, { desc }) => [desc(apps.createdAt)],
            limit: safeLimit + 1,
            offset: safeOffset
        });

        const hasMore = applications.length > safeLimit;
        const slicedApplications = applications.slice(0, safeLimit);
        const decisionMap = await getDecisionMetadataMap(slicedApplications.map((app) => app.id));

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

        const payload = {
            success: true,
            applications: slicedApplications.map((app) => {
                const isIncoming = app.creatorId === user.id;
                const decisionMeta = decisionMap.get(app.id);
                const decisionReasonRaw = decisionMeta?.reasonCode || null;
                const decisionReason = decisionReasonRaw
                    ? normalizeApplicationDecisionReason(decisionReasonRaw, 'other')
                    : null;
                const lifecycleStatus = resolveLifecycleStatus(app.status, decisionReason);

                let displayUser: {
                    id?: string;
                    username?: string | null;
                    fullName?: string | null;
                    avatarUrl?: string | null;
                    type: 'applicant' | 'creator';
                };

                if (isIncoming) {
                    displayUser = {
                        id: app.applicant?.id,
                        username: app.applicant?.username,
                        fullName: app.applicant?.fullName,
                        avatarUrl: app.applicant?.avatarUrl,
                        type: 'applicant',
                    };
                } else {
                    const creatorId = app.project?.ownerId || app.creatorId;
                    const creator = creatorsMap.get(creatorId);
                    displayUser = {
                        id: creatorId,
                        username: creator?.username,
                        fullName: creator?.fullName,
                        avatarUrl: creator?.avatarUrl,
                        type: 'creator',
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
                    lifecycleStatus,
                    decisionReason,
                    decisionAt: decisionMeta?.decisionAt || toISODate(app.updatedAt),
                    createdAt: app.createdAt,
                    conversationId: app.conversationId,
                };
            }),
            hasMore,
        };
        const elapsedMs = Date.now() - startedAtMs;
        if (elapsedMs > 300) {
            console.info('[applications] getInboxApplicationsAction slow-path', {
                limit,
                offset: safeOffset,
                count: payload.applications.length,
                elapsedMs,
            });
        }
        return payload;
    } catch (error) {
        console.error('Failed to get inbox applications:', error);
        return { success: false, applications: [], hasMore: false };
    }
}

export async function getApplicationRequestHistory(limit: number = 80): Promise<{
    success: boolean;
    items: ApplicationRequestHistoryItem[];
    error?: string;
}> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) return { success: false, items: [], error: 'Not authenticated' };

        const effectiveLimit = Math.max(1, Math.min(limit, 200));

        const applications = await db.query.roleApplications.findMany({
            where: or(eq(roleApplications.applicantId, user.id), eq(roleApplications.creatorId, user.id)),
            with: {
                project: {
                    columns: { id: true, title: true, slug: true, ownerId: true },
                },
                role: {
                    columns: { role: true, title: true },
                },
                applicant: {
                    columns: { id: true, username: true, fullName: true, avatarUrl: true },
                },
            },
            columns: {
                id: true,
                applicantId: true,
                creatorId: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                conversationId: true,
                projectId: true,
            },
            orderBy: (apps, { desc }) => [desc(apps.updatedAt), desc(apps.createdAt)],
            limit: effectiveLimit,
        });

        if (applications.length === 0) return { success: true, items: [] };

        const decisionMap = await getDecisionMetadataMap(applications.map((app) => app.id));

        const creatorIds = [
            ...new Set(
                applications
                    .filter((app) => app.applicantId === user.id)
                    .map((app) => app.project?.ownerId || app.creatorId)
                    .filter((id): id is string => !!id),
            ),
        ];

        const creatorRows =
            creatorIds.length > 0
                ? await db.query.profiles.findMany({
                    where: inArray(profiles.id, creatorIds),
                    columns: { id: true, username: true, fullName: true, avatarUrl: true },
                })
                : [];

        const creatorsById = new Map(
            creatorRows.map((row) => [
                row.id,
                {
                    id: row.id,
                    username: row.username,
                    fullName: row.fullName,
                    avatarUrl: row.avatarUrl,
                },
            ]),
        );

        const items = applications
            .map<ApplicationRequestHistoryItem>((app) => {
                const isIncoming = app.creatorId === user.id && app.applicantId !== user.id;
                const decisionMeta = decisionMap.get(app.id);
                const decisionReasonRaw = decisionMeta?.reasonCode || null;
                const decisionReason = decisionReasonRaw
                    ? normalizeApplicationDecisionReason(decisionReasonRaw, 'other')
                    : null;
                const lifecycleStatus = resolveLifecycleStatus(app.status, decisionReason);
                const decisionTimestamp = decisionMeta?.decisionAt
                    ? new Date(decisionMeta.decisionAt)
                    : app.updatedAt;
                const roleTitle = app.role?.title || app.role?.role || 'Unknown Role';

                const counterpart = isIncoming
                    ? {
                        id: app.applicant?.id || app.applicantId,
                        username: app.applicant?.username || null,
                        fullName: app.applicant?.fullName || null,
                        avatarUrl: app.applicant?.avatarUrl || null,
                    }
                    : creatorsById.get(app.project?.ownerId || app.creatorId) || null;

                return {
                    id: app.id,
                    kind: 'application',
                    direction: isIncoming ? 'incoming' : 'outgoing',
                    status: lifecycleStatus,
                    decisionReason,
                    eventAt: (lifecycleStatus === 'pending' ? app.createdAt : decisionTimestamp).toISOString(),
                    createdAt: app.createdAt.toISOString(),
                    conversationId: app.conversationId,
                    project: {
                        id: app.projectId,
                        title: app.project?.title || 'Unknown Project',
                        slug: app.project?.slug || null,
                    },
                    roleTitle,
                    user: counterpart,
                };
            })
            .sort((a, b) => new Date(b.eventAt).getTime() - new Date(a.eventAt).getTime());

        return { success: true, items };
    } catch (error) {
        console.error('Failed to load application request history:', error);
        return { success: false, items: [], error: 'Failed to load history' };
    }
}
