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
    profiles,
    messageWorkflowItems
} from '@/lib/db/schema';
import { eq, and, sql, or, inArray, desc, lt, exists, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { trackApplicationEvent } from '@/lib/telemetry/otlp';
import { runInFlightDeduped } from '@/lib/utils/inflight-dedupe';
import { toIsoString as toISODate } from '@/lib/utils/date';
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
import type { ApplicationCoreStatus } from '@/lib/applications/status';
import { isApplicationReviewerRole } from '@/lib/applications/authorization';
import { enqueueProjectNotificationEvent } from '@/lib/notifications/project-events';
import type {
    ApplicationActionOptions,
    ApplicationActionResult,
    ApplicationCursorPaginationInput,
    ApplicationRequestHistoryItem,
    ApplicationStatusResult,
    ApplicationActionErrorCode,
} from './types';
import { refreshWorkspaceCountersForUsers } from '@/lib/workspace/profile-counters';
import { addProjectMemberInternal } from '@/lib/projects/collaborator-lifecycle';
import { computeProjectReadAccess } from '@/lib/data/project-access';

// ============================================================================
// TYPES
// ============================================================================
type ApplicationDecisionStatus = 'accepted' | 'rejected' | 'withdrawn' | 'proposed';

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

function messageMetadataText(key: string) {
    return sql<string>`${messages.metadata}->>${key}`;
}

function nullableMessageMetadataText(key: string) {
    return sql<string | null>`${messages.metadata}->>${key}`;
}

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

interface CompoundCursor {
    source: 'app' | 'invite';
    createdAt: Date;
    id: string;
}

function parseCompoundCursor(rawCursor?: string | null): CompoundCursor | null {
    if (!rawCursor) return null;
    try {
        const decoded = Buffer.from(rawCursor, 'base64').toString('utf8');
        const [source, iso, id] = decoded.split(':::');
        if ((source !== 'app' && source !== 'invite') || !iso || !id) {
            return null;
        }
        const createdAt = new Date(iso);
        if (Number.isNaN(createdAt.getTime())) {
            return null;
        }
        return { source: source as 'app' | 'invite', createdAt, id };
    } catch {
        return null;
    }
}

function encodeCompoundCursor(source: 'app' | 'invite', createdAt: Date, id: string): string {
    return Buffer.from(`${source}:::${createdAt.toISOString()}:::${id}`, 'utf8').toString('base64');
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
    if (status === 'withdrawn') {
        return 'Application withdrawn by applicant';
    }
    if (status === 'proposed') {
        return 'Role change proposed by project lead';
    }
    const reasonKey = normalizeDecisionReasonCode(reason);
    return APPLICATION_DECISION_REASON_TEMPLATES[reasonKey];
}

function applicationActorSnapshot(user: { user_metadata?: Record<string, unknown> | null }) {
    return {
        actorName: (user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.username as string | undefined) ?? null,
        actorAvatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
    };
}

async function enqueueApplicationReceivedBestEffort(params: {
    applicationId: string;
    projectId: string;
    projectSlug?: string | null;
    projectTitle?: string | null;
    roleId?: string | null;
    roleTitle?: string | null;
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl?: string | null;
    traceId: string;
}) {
    try {
        await enqueueProjectNotificationEvent({
            projectId: params.projectId,
            actorUserId: params.actorUserId,
            actorName: params.actorName,
            actorAvatarUrl: params.actorAvatarUrl ?? null,
            eventKey: "applications.received",
            title: `${params.actorName || "Someone"} applied to ${params.projectTitle || "your project"}`,
            body: params.roleTitle ? `Role: ${params.roleTitle}` : params.projectTitle ? `Project: ${params.projectTitle}` : "New application received",
            href: `/people?tab=requests&applicationId=${encodeURIComponent(params.applicationId)}`,
            entityRefs: {
                applicationId: params.applicationId,
                projectId: params.projectId,
                projectSlug: params.projectSlug ?? null,
                roleId: params.roleId ?? null,
            },
            preview: {
                actorName: params.actorName,
                actorAvatarUrl: params.actorAvatarUrl ?? null,
                contextLabel: params.projectTitle ?? "Application",
                contextKind: "application",
                secondaryText: params.roleTitle ?? "Application received",
            },
            sourceEventId: params.applicationId,
        });
    } catch (notificationError) {
        console.error('[applications] Failed to enqueue application received notification', {
            applicationId: params.applicationId,
            actorUserId: params.actorUserId,
            projectId: params.projectId,
            projectSlug: params.projectSlug ?? null,
            projectTitle: params.projectTitle ?? null,
            traceId: params.traceId,
            error: notificationError instanceof Error ? notificationError.message : String(notificationError),
        });
    }
}

async function enqueueApplicationDecisionBestEffort(params: {
    applicationId: string;
    status: "accepted" | "rejected" | "reopened";
    conversationId?: string | null;
    projectId: string;
    projectSlug?: string | null;
    projectTitle?: string | null;
    roleId?: string | null;
    applicantId: string;
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl?: string | null;
    traceId: string;
}) {
    try {
        await enqueueProjectNotificationEvent({
            projectId: params.projectId,
            actorUserId: params.actorUserId,
            actorName: params.actorName,
            actorAvatarUrl: params.actorAvatarUrl ?? null,
            eventKey: "applications.decision",
            applicantId: params.applicantId,
            title: `${params.actorName || "Someone"} ${params.status === "accepted" ? "accepted" : params.status === "rejected" ? "updated" : "reopened"} your application`,
            body: params.projectTitle ? `Project: ${params.projectTitle}` : null,
            href: params.conversationId
                ? `/messages?conversationId=${encodeURIComponent(params.conversationId)}`
                : `/people?tab=requests&applicationId=${encodeURIComponent(params.applicationId)}`,
            entityRefs: {
                applicationId: params.applicationId,
                conversationId: params.conversationId ?? null,
                projectId: params.projectId,
                projectSlug: params.projectSlug ?? null,
                roleId: params.roleId ?? null,
            },
            preview: {
                actorName: params.actorName,
                actorAvatarUrl: params.actorAvatarUrl ?? null,
                contextLabel: params.projectTitle ?? "Application",
                contextKind: "application",
                secondaryText: params.status,
            },
            sourceEventId: `${params.applicationId}:${params.status}`,
        });
    } catch (notificationError) {
        console.error('[applications] Failed to enqueue application decision notification', {
            applicationId: params.applicationId,
            status: params.status,
            actorUserId: params.actorUserId,
            recipientUserId: params.applicantId,
            traceId: params.traceId,
            error: notificationError instanceof Error ? notificationError.message : String(notificationError),
        });
    }
}

async function enqueueApplicationWithdrawnBestEffort(params: {
    applicationId: string;
    projectId: string;
    projectSlug?: string | null;
    projectTitle?: string | null;
    roleId?: string | null;
    roleTitle?: string | null;
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl?: string | null;
    traceId: string;
}) {
    try {
        await enqueueProjectNotificationEvent({
            projectId: params.projectId,
            actorUserId: params.actorUserId,
            actorName: params.actorName,
            actorAvatarUrl: params.actorAvatarUrl ?? null,
            eventKey: "applications.withdrawn",
            title: `${params.actorName || "Someone"} withdrew an application`,
            body: params.roleTitle ? `Role: ${params.roleTitle}` : params.projectTitle ? `Project: ${params.projectTitle}` : "Application withdrawn",
            href: `/people?tab=requests&applicationId=${encodeURIComponent(params.applicationId)}`,
            entityRefs: {
                applicationId: params.applicationId,
                projectId: params.projectId,
                projectSlug: params.projectSlug ?? null,
                roleId: params.roleId ?? null,
            },
            preview: {
                actorName: params.actorName,
                actorAvatarUrl: params.actorAvatarUrl ?? null,
                contextLabel: params.projectTitle ?? "Application",
                contextKind: "application",
                secondaryText: "Withdrawn",
            },
            sourceEventId: `${params.applicationId}:withdrawn`,
        });
    } catch (notificationError) {
        console.error('[applications] Failed to enqueue application withdrawn notification', {
            applicationId: params.applicationId,
            actorUserId: params.actorUserId,
            projectId: params.projectId,
            traceId: params.traceId,
            error: notificationError instanceof Error ? notificationError.message : String(notificationError),
        });
    }
}

async function enqueueMemberJoinedBestEffort(params: {
    projectId: string;
    projectSlug?: string | null;
    projectTitle?: string | null;
    applicationId?: string | null;
    roleId?: string | null;
    targetUserId: string;
    targetName: string;
    targetAvatarUrl?: string | null;
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl?: string | null;
    sourceEventId?: string | null;
    traceId: string;
}) {
    try {
        await enqueueProjectNotificationEvent({
            projectId: params.projectId,
            actorUserId: params.actorUserId,
            actorName: params.actorName,
            actorAvatarUrl: params.actorAvatarUrl ?? null,
            eventKey: "members.joined",
            title: `${params.targetName} joined ${params.projectTitle || "the project"}`,
            body: "A new member joined the project.",
            href: `/projects/${encodeURIComponent(params.projectSlug || params.projectId)}?tab=settings&settings=collaborators`,
            entityRefs: {
                projectId: params.projectId,
                projectSlug: params.projectSlug ?? null,
                applicationId: params.applicationId ?? null,
                roleId: params.roleId ?? null,
                targetUserId: params.targetUserId,
            },
            preview: {
                actorName: params.targetName,
                actorAvatarUrl: params.targetAvatarUrl ?? null,
                contextLabel: params.projectTitle ?? "Project",
                contextKind: "project",
                secondaryText: "New project member",
            },
            sourceEventId: params.sourceEventId ?? `${params.targetUserId}:member-joined`,
        });
    } catch (notificationError) {
        console.error('[applications] Failed to enqueue member joined notification', {
            projectId: params.projectId,
            targetUserId: params.targetUserId,
            actorUserId: params.actorUserId,
            traceId: params.traceId,
            error: notificationError instanceof Error ? notificationError.message : String(notificationError),
        });
    }
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
                applicationId: messageMetadataText('applicationId'),
                reasonCode: nullableMessageMetadataText('reasonCode'),
                decisionAt: nullableMessageMetadataText('decisionAt'),
                createdAt: messages.createdAt,
            })
            .from(messages)
            .where(
                and(
                    eq(messageMetadataText('kind'), 'application_decision'),
                    inArray(messageMetadataText('applicationId'), chunk),
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
    const participantA = alias(conversationParticipants, 'legacy_dm_participant_a');
    const participantB = alias(conversationParticipants, 'legacy_dm_participant_b');
    const legacyConversation = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(
            and(
                eq(conversations.type, 'dm'),
                exists(
                    tx
                        .select({ conversationId: participantA.conversationId })
                        .from(participantA)
                        .where(
                            and(
                                eq(participantA.conversationId, conversations.id),
                                eq(participantA.userId, userA)
                            )
                        )
                ),
                exists(
                    tx
                        .select({ conversationId: participantB.conversationId })
                        .from(participantB)
                        .where(
                            and(
                                eq(participantB.conversationId, conversations.id),
                                eq(participantB.userId, userB)
                            )
                        )
                )
            )
        )
        .limit(1);

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

    const legacyApplicationMessages = existingByClientId
        ? []
        : await tx
            .select({ id: messages.id, metadata: messages.metadata })
            .from(messages)
            .where(
                and(
                    eq(messages.conversationId, conversationId),
                    eq(messages.senderId, applicantId),
                    isNull(messages.deletedAt),
                    eq(messageMetadataText('kind'), 'application'),
                    eq(messageMetadataText('applicationId'), applicationId)
                )
            )
            .orderBy(desc(messages.createdAt))
            .limit(1);
    const legacyApplicationMessage = legacyApplicationMessages[0] ?? null;

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
    status: 'accepted' | 'rejected' | 'pending' | 'withdrawn' | 'proposed',
    customMessage?: string,
    reason?: string,
    applicationTraceId?: string,
    originalRoleTitle?: string
): Promise<void> {
    const statusText =
        status === 'accepted'
            ? 'Accepted'
            : status === 'rejected'
            ? 'Not Accepted'
            : status === 'withdrawn'
            ? 'Withdrawn'
            : status === 'proposed'
            ? 'Role Change Proposed'
            : 'Reopened';
    const messageText = `Application ${statusText}`;
    const decisionAt = new Date().toISOString();
    const resolvedMessage =
        status === 'pending'
            ? (customMessage || '').trim() || 'Application reopened for review.'
            : resolveDecisionMessage(status as ApplicationDecisionStatus, customMessage, reason);
    const clientMessageId =
        status === 'pending'
            ? buildApplicationReopenClientMessageId(applicationId)
            : buildApplicationDecisionClientMessageId(applicationId, status as ApplicationDecisionStatus);
    const decisionMetadata = {
        kind: 'application_update',
        isApplicationUpdate: true,
        eventVersion: 2,
        applicationId,
        projectId,
        roleId,
        projectTitle,
        roleTitle,
        originalRoleTitle: originalRoleTitle || null,
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
    const updated = await tx
        .update(messages)
        .set({
            metadata: sql`
                jsonb_set(
                    jsonb_set(
                        COALESCE(${messages.metadata}, '{}'::jsonb),
                        '{status}',
                        to_jsonb(${status}::text)
                    ),
                    '{eventVersion}',
                    '2'::jsonb
                )
            `,
        })
        .where(
            and(
                eq(messages.conversationId, conversationId),
                isNull(messages.deletedAt),
                eq(messageMetadataText('kind'), 'application'),
                eq(messageMetadataText('applicationId'), applicationId)
            )
        )
        .returning({ id: messages.id, metadata: messages.metadata });

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
            columns: { id: true, status: true, roleId: true, proposedRoleId: true, updatedAt: true, decisionBy: true }
        });

        if (application) {
            if (application.status === 'proposed') {
                const proposedRole = application.proposedRoleId
                    ? await db.query.projectOpenRoles.findFirst({
                        where: eq(projectOpenRoles.id, application.proposedRoleId),
                        columns: { role: true, title: true }
                    })
                    : null;
                const proposedRoleTitle = proposedRole?.title || proposedRole?.role || 'Unknown Role';
                return {
                    status: 'proposed',
                    roleId: application.proposedRoleId || undefined,
                    roleTitle: proposedRoleTitle,
                    applicationId: application.id,
                    proposedRoleId: application.proposedRoleId || undefined,
                    proposedRoleTitle,
                    updatedAt: application.updatedAt,
                };
            }

            if (application.status === 'rejected' || application.status === 'withdrawn') {
                const pendingInvite = await db.query.messageWorkflowItems.findFirst({
                    where: and(
                        eq(messageWorkflowItems.projectId, projectId),
                        eq(messageWorkflowItems.assigneeUserId, user.id),
                        eq(messageWorkflowItems.kind, 'project_invite'),
                        eq(messageWorkflowItems.status, 'pending')
                    ),
                    orderBy: desc(messageWorkflowItems.createdAt)
                });
                if (pendingInvite) {
                    return {
                        status: 'proposed',
                        roleId: (pendingInvite.payload.roleId as string) || undefined,
                        roleTitle: (pendingInvite.payload.roleTitle as string) || 'Collaborator',
                        workflowItemId: pendingInvite.id,
                        proposedRoleId: (pendingInvite.payload.roleId as string) || undefined,
                        proposedRoleTitle: (pendingInvite.payload.roleTitle as string) || 'Collaborator',
                        updatedAt: pendingInvite.updatedAt,
                    };
                }
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
                        roleId: application.roleId || undefined,
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
                    roleId: application.roleId || undefined,
                    roleTitle,
                    decisionReason,
                    lifecycleStatus,
                    canReapply: canApply,
                    waitTime,
                    updatedAt: application.updatedAt
                };
            }

            const activeMembership = application.status === 'accepted'
                ? await db.query.projectMembers.findFirst({
                    where: and(
                        eq(projectMembers.projectId, projectId),
                        eq(projectMembers.userId, user.id),
                    ),
                    columns: { id: true },
                })
                : null;

            return {
                status: application.status as ApplicationCoreStatus,
                roleId: application.roleId || undefined,
                roleTitle,
                decisionReason,
                lifecycleStatus,
                updatedAt: application.updatedAt,
                membershipEnded: application.status === 'accepted' && !activeMembership,
                applicationId: application.id,
            };
        }

        // Check for direct invitations when there is no application record
        const pendingInvite = await db.query.messageWorkflowItems.findFirst({
            where: and(
                eq(messageWorkflowItems.projectId, projectId),
                eq(messageWorkflowItems.assigneeUserId, user.id),
                eq(messageWorkflowItems.kind, 'project_invite'),
                eq(messageWorkflowItems.status, 'pending')
            ),
            orderBy: desc(messageWorkflowItems.createdAt)
        });

        if (pendingInvite) {
            return {
                status: 'proposed',
                roleId: (pendingInvite.payload.roleId as string) || undefined,
                roleTitle: (pendingInvite.payload.roleTitle as string) || 'Collaborator',
                workflowItemId: pendingInvite.id,
                proposedRoleId: (pendingInvite.payload.roleId as string) || undefined,
                proposedRoleTitle: (pendingInvite.payload.roleTitle as string) || 'Collaborator',
                updatedAt: pendingInvite.updatedAt,
            };
        }

        return { status: 'none' };
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
                    columns: { id: true, ownerId: true, slug: true, title: true, visibility: true, status: true }
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
            const canReadProject = computeProjectReadAccess(
                project.visibility,
                project.status,
                project.ownerId === user.id,
                Boolean(existingMember),
            );
            if (!canReadProject && (!existingApp || existingApp.status === 'rejected')) {
                return toApplicationFailure(traceId, 'FORBIDDEN', 'This project is private.');
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
                                applyingProjectId: options?.applyingProjectId || null,
                                applyingProjectRole: options?.applyingProjectRole || null,
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
                    await enqueueApplicationReceivedBestEffort({
                        applicationId: existingApp.id,
                        projectId,
                        projectSlug: project.slug ?? null,
                        projectTitle: project.title ?? null,
                        roleId,
                        roleTitle: roleTitleText,
                        actorUserId: user.id,
                        ...applicationActorSnapshot(user),
                        traceId,
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
                        applyingProjectId: options?.applyingProjectId || null,
                        applyingProjectRole: options?.applyingProjectRole || null,
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
                    newApp!.id,
                    traceId
                );

                await tx.update(roleApplications)
                    .set({ conversationId, updatedAt: new Date() })
                    .where(eq(roleApplications.id, newApp!.id));

                return { applicationId: newApp!.id, conversationId };
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
            await enqueueApplicationReceivedBestEffort({
                applicationId: newApplicationId,
                projectId,
                projectSlug: project.slug ?? null,
                projectTitle: project.title ?? null,
                roleId,
                roleTitle: roleTitleText,
                actorUserId: user.id,
                ...applicationActorSnapshot(user),
                traceId,
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
            if (application.applicantId === user.id) {
                return toApplicationFailure(traceId, 'FORBIDDEN', 'You cannot review your own application');
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

            const memberLifecycle = await db.transaction(async (tx) => {
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
                    columns: { id: true, role: true }
                });

                const lifecycle = await addProjectMemberInternal(tx, {
                    projectId: application.projectId,
                    userId: application.applicantId,
                    role: 'member',
                    actorId: user.id,
                    source: 'application_accept',
                    applicationId,
                    roleId: application.roleId,
                    incrementRoleCapacity: !existingMember || existingMember.role === 'viewer',
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
                        application.roleId || "",
                        application.project?.title || 'Project',
                        application.role?.title || application.role?.role || 'Role',
                        'accepted',
                        message,
                        undefined,
                        traceId
                    );
                }

                return lifecycle;
            });

            const slugOrId = application.project?.slug || application.projectId;
            revalidatePath(`/projects/${slugOrId}`);
            revalidatePath('/people');
            revalidatePath('/messages');
            trackApplicationEvent('apply_accepted', {
                applicationId,
                projectId: application.projectId,
                roleId: application.roleId || undefined,
                actorId: user.id,
                source: 'requests',
                applicationTraceId: traceId,
            });
            if (memberLifecycle.changed) {
                const memberName = memberLifecycle.target?.fullName || memberLifecycle.target?.username || "A member";
                await enqueueMemberJoinedBestEffort({
                    projectId: application.projectId,
                    projectSlug: application.project?.slug ?? null,
                    projectTitle: application.project?.title ?? null,
                    applicationId,
                    roleId: application.roleId,
                    targetUserId: application.applicantId,
                    targetName: memberName,
                    targetAvatarUrl: memberLifecycle.target?.avatarUrl ?? null,
                    actorUserId: user.id,
                    ...applicationActorSnapshot(user),
                    sourceEventId: memberLifecycle.eventId ?? `${applicationId}:member-joined`,
                    traceId,
                });
            }
            await enqueueApplicationDecisionBestEffort({
                applicationId,
                status: 'accepted',
                conversationId: application.conversationId ?? null,
                projectId: application.projectId,
                projectSlug: application.project?.slug ?? null,
                projectTitle: application.project?.title ?? null,
                roleId: application.roleId,
                applicantId: application.applicantId,
                actorUserId: user.id,
                ...applicationActorSnapshot(user),
                traceId,
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
                columns: { id: true, applicantId: true, creatorId: true, projectId: true, roleId: true, status: true, conversationId: true }
            });

            if (!application) {
                return toApplicationFailure(traceId, 'NOT_FOUND', 'Application not found');
            }
            if (application.applicantId === user.id) {
                return toApplicationFailure(traceId, 'FORBIDDEN', 'You cannot review your own application');
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
                        application.roleId || "",
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
                roleId: application.roleId || undefined,
                actorId: user.id,
                reasonCode: normalizedReason || null,
                source: 'requests',
                applicationTraceId: traceId,
            });
            await enqueueApplicationDecisionBestEffort({
                applicationId,
                status: 'rejected',
                conversationId: application.conversationId ?? null,
                projectId: application.projectId,
                projectSlug: application.project?.slug ?? null,
                projectTitle: application.project?.title ?? null,
                roleId: application.roleId,
                applicantId: application.applicantId,
                actorUserId: user.id,
                ...applicationActorSnapshot(user),
                traceId,
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
                application.roleId || "",
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
            roleId: application.roleId || undefined,
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
        if (application.status === 'withdrawn' || application.status === 'rejected') {
            return toApplicationSuccess(traceId, { applicationId, idempotent: true });
        }

        await db.transaction(async (tx) => {
            const transitioned = await transitionApplicationDecisionInternal(tx, {
                applicationId,
                status: 'withdrawn',
                decisionBy: user.id,
            });

            if (!transitioned) {
                throw new Error('Application already processed');
            }

            await syncCanonicalApplicationMessageDecisionInternal(tx, {
                applicationId,
                conversationId: application.conversationId,
                status: 'withdrawn',
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
                    application.roleId || "",
                    application.project?.title || 'Project',
                    application.role?.title || application.role?.role || 'Role',
                    'withdrawn',
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
            roleId: application.roleId || undefined,
            actorId: user.id,
            reasonCode: 'withdrawn_by_applicant',
            source: 'messages',
            applicationTraceId: traceId,
        });
        await enqueueApplicationWithdrawnBestEffort({
            applicationId,
            projectId: application.projectId,
            projectSlug: application.project?.slug ?? null,
            projectTitle: application.project?.title ?? null,
            roleId: application.roleId,
            roleTitle: application.role?.title || application.role?.role || null,
            actorUserId: user.id,
            ...applicationActorSnapshot(user),
            traceId,
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
                applicantId: true,
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
        if (application.applicantId === user.id) {
            return toApplicationFailure(traceId, 'FORBIDDEN', 'You cannot review your own application');
        }

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
                    application.roleId || "",
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
            roleId: application.roleId || undefined,
            actorId: user.id,
            source: 'messages',
            applicationTraceId: traceId,
        });
        await enqueueApplicationDecisionBestEffort({
            applicationId,
            status: 'reopened',
            conversationId: application.conversationId ?? null,
            projectId: application.projectId,
            projectSlug: application.project?.slug ?? null,
            projectTitle: application.project?.title ?? null,
            roleId: application.roleId,
            applicantId: application.applicantId,
            actorUserId: user.id,
            ...applicationActorSnapshot(user),
            traceId,
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

        const compCursor = parseCompoundCursor(pagination.cursor);
        const oldCursorResult = normalizeCursorPaginationInput(pagination);
        const safeLimit = oldCursorResult.safeLimit;
        const cursorDate = compCursor ? compCursor.createdAt : oldCursorResult.cursor?.createdAt;
        const cursorId = compCursor ? compCursor.id : oldCursorResult.cursor?.id;

        const appWhere = cursorDate && cursorId
            ? and(
                eq(roleApplications.applicantId, user.id),
                or(
                    lt(roleApplications.createdAt, cursorDate),
                    and(eq(roleApplications.createdAt, cursorDate), lt(roleApplications.id, cursorId))
                )
            )
            : eq(roleApplications.applicantId, user.id);

        const inviteWhere = cursorDate && cursorId
            ? and(
                eq(messageWorkflowItems.creatorId, user.id),
                eq(messageWorkflowItems.kind, 'project_invite'),
                or(
                    lt(messageWorkflowItems.createdAt, cursorDate),
                    and(eq(messageWorkflowItems.createdAt, cursorDate), lt(messageWorkflowItems.id, cursorId))
                )
            )
            : and(
                eq(messageWorkflowItems.creatorId, user.id),
                eq(messageWorkflowItems.kind, 'project_invite')
            );

        const roleApps = await db.query.roleApplications.findMany({
            where: appWhere,
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

        const invites = await db.query.messageWorkflowItems.findMany({
            where: inviteWhere,
            with: {
                project: {
                    columns: { id: true, title: true, slug: true, coverImage: true }
                },
                assignee: {
                    columns: { id: true, username: true, fullName: true, avatarUrl: true }
                }
            },
            columns: {
                id: true,
                projectId: true,
                assigneeUserId: true,
                status: true,
                payload: true,
                createdAt: true,
                updatedAt: true,
                conversationId: true,
            },
            orderBy: (items, { desc }) => [desc(items.createdAt), desc(items.id)],
            limit: safeLimit + 1,
        });

        const decisionMap = await getDecisionMetadataMap(roleApps.map((app) => app.id));

        const mappedApps = roleApps.map((app) => {
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
        });

        const mappedInvites = invites.map((invite) => {
            let status: 'pending' | 'accepted' | 'rejected' | 'withdrawn' = 'pending';
            let decisionReason: string | null = null;
            if (invite.status === 'declined') {
                status = 'rejected';
            } else if (invite.status === 'canceled') {
                status = 'withdrawn';
            } else if (invite.status === 'expired') {
                status = 'rejected';
                decisionReason = 'role_filled';
            } else if (invite.status === 'accepted') {
                status = 'accepted';
            }

            const lifecycleStatus = resolveLifecycleStatus(status, decisionReason);

            return {
                id: invite.id,
                isWorkflowItem: true,
                projectId: invite.projectId,
                projectTitle: invite.project?.title || (invite.payload?.projectTitle as string) || 'Unknown Project',
                projectSlug: invite.project?.slug || (invite.payload?.projectSlug as string),
                projectCover: invite.project?.coverImage || null,
                roleTitle: (invite.payload?.roleTitle as string) || 'Collaborator',
                message: invite.payload?.note as string | null,
                status,
                lifecycleStatus,
                decisionReason,
                createdAt: invite.createdAt,
                updatedAt: invite.updatedAt,
                decisionAt: toISODate(invite.updatedAt),
                conversationId: invite.conversationId,
                canEdit: false,
            };
        });

        const combined = [
            ...mappedApps.map(item => ({ ...item, _source: 'app' as const })),
            ...mappedInvites.map(item => ({ ...item, _source: 'invite' as const }))
        ].sort((a, b) => {
            const timeDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            if (timeDiff !== 0) return timeDiff;
            return b.id.localeCompare(a.id);
        });

        const hasMore = combined.length > safeLimit;
        const sliced = combined.slice(0, safeLimit);

        let nextCursor = null;
        if (hasMore && sliced.length > 0) {
            const lastItem = sliced[sliced.length - 1]!;
            nextCursor = encodeCompoundCursor(lastItem._source, lastItem.createdAt, lastItem.id);
        }

        return {
            success: true,
            applications: sliced.map(({ _source, ...rest }) => rest),
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
export async function getIncomingApplicationsAction(
    pagination: ApplicationCursorPaginationInput = { limit: APPLICATION_LIST_DEFAULT_LIMIT }
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

        const { safeLimit } = normalizeApplicationListPagination(pagination.limit, 0);

        let cursorDate: Date | undefined;
        let cursorId: string | undefined;

        const compCursor = parseCompoundCursor(pagination.cursor);
        if (compCursor) {
            cursorDate = compCursor.createdAt;
            cursorId = compCursor.id;
        } else {
            const oldCursorResult = normalizeCursorPaginationInput(pagination);
            if (oldCursorResult.cursor) {
                cursorDate = oldCursorResult.cursor.createdAt;
                cursorId = oldCursorResult.cursor.id;
            }
        }

        const appWhere = cursorDate && cursorId
            ? and(
                eq(roleApplications.creatorId, user.id),
                eq(roleApplications.status, 'pending'),
                or(
                    lt(roleApplications.createdAt, cursorDate),
                    and(eq(roleApplications.createdAt, cursorDate), lt(roleApplications.id, cursorId))
                )
            )
            : and(
                eq(roleApplications.creatorId, user.id),
                eq(roleApplications.status, 'pending')
            );

        const inviteWhere = cursorDate && cursorId
            ? and(
                eq(messageWorkflowItems.assigneeUserId, user.id),
                eq(messageWorkflowItems.kind, 'project_invite'),
                eq(messageWorkflowItems.status, 'pending'),
                or(
                    lt(messageWorkflowItems.createdAt, cursorDate),
                    and(eq(messageWorkflowItems.createdAt, cursorDate), lt(messageWorkflowItems.id, cursorId))
                )
            )
            : and(
                eq(messageWorkflowItems.assigneeUserId, user.id),
                eq(messageWorkflowItems.kind, 'project_invite'),
                eq(messageWorkflowItems.status, 'pending')
            );

        const roleApps = await db.query.roleApplications.findMany({
            where: appWhere,
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
        });

        const invites = await db.query.messageWorkflowItems.findMany({
            where: inviteWhere,
            with: {
                project: {
                    columns: { id: true, title: true, slug: true }
                },
                creator: {
                    columns: { id: true, username: true, fullName: true, avatarUrl: true, skills: true, headline: true }
                }
            },
            columns: {
                id: true,
                projectId: true,
                status: true,
                payload: true,
                createdAt: true,
                updatedAt: true,
                conversationId: true,
            },
            orderBy: (items, { desc }) => [desc(items.createdAt), desc(items.id)],
            limit: safeLimit + 1,
        });

        const mappedApps = roleApps.map((app) => ({
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
            status: app.status as 'pending' | 'accepted' | 'rejected' | 'withdrawn',
            createdAt: app.createdAt,
            conversationId: app.conversationId,
            isWorkflowItem: false,
        }));

        const mappedInvites = invites.map((invite) => {
            let status: 'pending' | 'accepted' | 'rejected' | 'withdrawn' = 'pending';
            if (invite.status === 'declined') {
                status = 'rejected';
            } else if (invite.status === 'canceled') {
                status = 'withdrawn';
            } else if (invite.status === 'expired') {
                status = 'rejected';
            } else if (invite.status === 'accepted') {
                status = 'accepted';
            }

            return {
                id: invite.id,
                projectId: invite.projectId,
                projectTitle: invite.project?.title || (invite.payload?.projectTitle as string) || 'Unknown Project',
                projectSlug: invite.project?.slug || (invite.payload?.projectSlug as string),
                roleTitle: (invite.payload?.roleTitle as string) || 'Collaborator',
                applicant: {
                    id: invite.creator?.id,
                    username: invite.creator?.username,
                    fullName: invite.creator?.fullName,
                    avatarUrl: invite.creator?.avatarUrl,
                    skills: invite.creator?.skills ?? [],
                    headline: invite.creator?.headline ?? null,
                },
                status,
                createdAt: invite.createdAt,
                conversationId: invite.conversationId,
                isWorkflowItem: true,
            };
        });

        const combined = [
            ...mappedApps.map(item => ({ ...item, _source: 'app' as const })),
            ...mappedInvites.map(item => ({ ...item, _source: 'invite' as const }))
        ].sort((a, b) => {
            const timeDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            if (timeDiff !== 0) return timeDiff;
            return b.id.localeCompare(a.id);
        });

        const sliced = combined.slice(0, safeLimit);
        const hasMore = combined.length > safeLimit;

        let nextCursor = null;
        if (hasMore && sliced.length > 0) {
            const lastItem = sliced[sliced.length - 1]!;
            nextCursor = encodeCompoundCursor(lastItem._source, lastItem.createdAt, lastItem.id);
        }

        return {
            success: true,
            applications: sliced.map(({ _source, ...rest }) => rest),
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

        // 1. Fetch role applications where:
        // - User is project owner (Incoming pending applications)
        // - User is applicant (Outgoing applications)
        const roleApps = await db.query.roleApplications.findMany({
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
                message: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                conversationId: true,
            },
        });

        // 2. Fetch project invitations (messageWorkflowItems of kind project_invite) where:
        // - User is Lead/creator (Outgoing project invites)
        // - User is candidate/assignee (Incoming project invites)
        const invites = await db.query.messageWorkflowItems.findMany({
            where: and(
                eq(messageWorkflowItems.kind, 'project_invite'),
                or(
                    eq(messageWorkflowItems.assigneeUserId, user.id),
                    eq(messageWorkflowItems.creatorId, user.id)
                )
            ),
            with: {
                project: {
                    columns: { id: true, title: true, slug: true, ownerId: true }
                },
                creator: {
                    columns: { id: true, username: true, fullName: true, avatarUrl: true }
                },
                assignee: {
                    columns: { id: true, username: true, fullName: true, avatarUrl: true }
                }
            },
            columns: {
                id: true,
                projectId: true,
                creatorId: true,
                assigneeUserId: true,
                status: true,
                payload: true,
                createdAt: true,
                updatedAt: true,
                conversationId: true,
            }
        });

        const decisionMap = await getDecisionMetadataMap(roleApps.map((app) => app.id));
        const conversationIds = [
            ...roleApps.map((app) => app.conversationId),
            ...invites.map((inv) => inv.conversationId)
        ].filter((conversationId): conversationId is string => typeof conversationId === 'string' && conversationId.length > 0);

        const unreadCounts = conversationIds.length > 0
            ? await db
                .select({
                    conversationId: conversationParticipants.conversationId,
                    unreadCount: conversationParticipants.unreadCount,
                })
                .from(conversationParticipants)
                .where(
                    and(
                        eq(conversationParticipants.userId, user.id),
                        inArray(conversationParticipants.conversationId, conversationIds),
                    ),
                )
            : [];
        const unreadCountByConversationId = new Map(
            unreadCounts.map((entry) => [entry.conversationId, entry.unreadCount]),
        );

        // Fetch creator profiles for outgoing applications
        const creatorIds = roleApps
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

        // Map applications
        const mappedApps = roleApps.map((app) => {
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
                isWorkflowItem: false,
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
                coverLetter: app.message,
                unreadCount: app.conversationId
                    ? unreadCountByConversationId.get(app.conversationId) ?? 0
                    : 0,
            };
        });

        // Map invitations
        const mappedInvites = invites.map((invite) => {
            const isIncoming = invite.assigneeUserId === user.id;

            let status: 'pending' | 'accepted' | 'rejected' | 'withdrawn' = 'pending';
            let decisionReason: string | null = null;
            if (invite.status === 'declined') {
                status = 'rejected';
            } else if (invite.status === 'canceled') {
                status = 'withdrawn';
            } else if (invite.status === 'expired') {
                status = 'rejected';
                decisionReason = 'role_filled';
            } else if (invite.status === 'accepted') {
                status = 'accepted';
            }

            const lifecycleStatus = resolveLifecycleStatus(status, decisionReason);

            let displayUser: {
                id?: string;
                username?: string | null;
                fullName?: string | null;
                avatarUrl?: string | null;
                type: 'applicant' | 'creator';
            };

            if (isIncoming) {
                displayUser = {
                    id: invite.creator?.id,
                    username: invite.creator?.username,
                    fullName: invite.creator?.fullName,
                    avatarUrl: invite.creator?.avatarUrl,
                    type: 'creator',
                };
            } else {
                displayUser = {
                    id: invite.assignee?.id,
                    username: invite.assignee?.username,
                    fullName: invite.assignee?.fullName,
                    avatarUrl: invite.assignee?.avatarUrl,
                    type: 'applicant',
                };
            }

            return {
                id: invite.id,
                isWorkflowItem: true,
                type: isIncoming ? 'incoming' : 'outgoing',
                projectId: invite.projectId,
                projectTitle: invite.project?.title || (invite.payload?.projectTitle as string) || 'Unknown Project',
                projectSlug: invite.project?.slug || (invite.payload?.projectSlug as string),
                roleTitle: (invite.payload?.roleTitle as string) || 'Collaborator',
                displayUser,
                status,
                lifecycleStatus,
                decisionReason,
                decisionAt: toISODate(invite.updatedAt),
                createdAt: invite.createdAt,
                conversationId: invite.conversationId,
                coverLetter: invite.payload?.note as string | null,
                unreadCount: invite.conversationId
                    ? unreadCountByConversationId.get(invite.conversationId) ?? 0
                    : 0,
            };
        });

        // Merge both collections, sort by createdAt DESC
        const combined = [...mappedApps, ...mappedInvites].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );

        const hasMore = combined.length > safeOffset + safeLimit;
        const sliced = combined.slice(safeOffset, safeOffset + safeLimit);

        const payload = {
            success: true,
            applications: sliced,
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

// ============================================================================
// ACCEPT PROPOSED ROLE CHANGE (Applicant only)
// ============================================================================
export async function acceptProposedRoleAction(
    applicationId: string,
    options?: ApplicationActionOptions
): Promise<ApplicationActionResult> {
    const traceId = resolveApplicationTraceId('accept_proposed', 'anon', applicationId, options);
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return toApplicationFailure(traceId, 'UNAUTHORIZED', 'Unauthorized');
        }

        const acceptProposedRate = await consumeRateLimit(`applications:accept_proposed:${user.id}`, 20, 60);
        if (!acceptProposedRate.allowed) {
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
                proposedRoleId: true,
                status: true,
                conversationId: true,
                decisionBy: true,
            },
        });

        if (!application) return toApplicationFailure(traceId, 'NOT_FOUND', 'Application not found');

        if (application.applicantId !== user.id) {
            return toApplicationFailure(traceId, 'FORBIDDEN', 'Only the applicant can accept a proposed role change');
        }

        if (application.status !== 'proposed') {
            return toApplicationFailure(traceId, 'INVALID_STATE', 'This application does not have a proposed role change to accept');
        }

        if (!application.proposedRoleId) {
            return toApplicationFailure(traceId, 'INVALID_STATE', 'No proposed role found on this application');
        }

        // Verify if user is already a member of the project:
        const isMember = await db.query.projectMembers.findFirst({
            where: and(
                eq(projectMembers.projectId, application.projectId),
                eq(projectMembers.userId, user.id)
            ),
        });
        if (isMember) {
            return toApplicationFailure(traceId, 'ALREADY_MEMBER', 'You are already a member of this project');
        }

        const updatedProposedRoleId = application.proposedRoleId;
        let pRoleTitle = '';
        await db.transaction(async (tx) => {
            // Pessimistic lock
            const [proposedRole] = await tx
                .select()
                .from(projectOpenRoles)
                .where(eq(projectOpenRoles.id, updatedProposedRoleId))
                .for('update');

            if (!proposedRole) {
                throw new Error('Proposed role not found');
            }

            pRoleTitle = proposedRole.title || proposedRole.role || 'Role';

            if (proposedRole.filled >= proposedRole.count) {
                throw new Error('Proposed role is already full');
            }

            // Update application
            await tx
                .update(roleApplications)
                .set({
                    status: 'accepted',
                    roleId: updatedProposedRoleId,
                    proposedRoleId: null,
                    decisionAt: new Date(),
                    decisionBy: application.decisionBy || user.id,
                    updatedAt: new Date(),
                })
                .where(eq(roleApplications.id, applicationId));

            // Add project member
            await addProjectMemberInternal(tx, {
                projectId: application.projectId,
                userId: user.id,
                role: 'member',
                actorId: user.id,
                source: 'application_accept',
                roleId: updatedProposedRoleId,
                incrementRoleCapacity: true,
            });

            await syncCanonicalApplicationMessageDecisionInternal(tx, {
                applicationId,
                conversationId: application.conversationId,
                status: 'accepted',
                decisionBy: user.id,
                reason: 'proposal_accepted_by_applicant',
                applicationTraceId: traceId,
            });

            if (application.conversationId) {
                await sendApplicationStatusUpdateInternal(
                    tx,
                    application.conversationId,
                    user.id,
                    applicationId,
                    application.projectId,
                    updatedProposedRoleId,
                    application.project?.title || 'Project',
                    pRoleTitle,
                    'accepted',
                    'Proposed role accepted by applicant.',
                    'proposal_accepted_by_applicant',
                    traceId
                );
            }
        });

        const slugOrId = application.project?.slug || application.projectId;
        revalidatePath(`/projects/${slugOrId}`);
        revalidatePath('/messages');
        revalidatePath('/people');

        trackApplicationEvent('apply_accepted', {
            applicationId,
            projectId: application.projectId,
            roleId: updatedProposedRoleId,
            actorId: user.id,
            reasonCode: 'proposal_accepted_by_applicant',
            source: 'messages',
            applicationTraceId: traceId,
        });

        return toApplicationSuccess(traceId, { applicationId });
    } catch (error) {
        console.error('Failed to accept proposed role change:', error);
        if (error instanceof Error && error.message === 'Proposed role is already full') {
            return toApplicationFailure(traceId, 'ROLE_FULL', 'The proposed role has already been filled');
        }
        return toApplicationFailure(traceId, 'INTERNAL_ERROR', 'Failed to accept proposed role change');
    }
}

// ============================================================================
// DECLINE PROPOSED ROLE CHANGE (Applicant only)
// ============================================================================
export async function declineProposedRoleAction(
    applicationId: string,
    options?: ApplicationActionOptions
): Promise<ApplicationActionResult> {
    const traceId = resolveApplicationTraceId('decline_proposed', 'anon', applicationId, options);
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return toApplicationFailure(traceId, 'UNAUTHORIZED', 'Unauthorized');
        }

        const declineProposedRate = await consumeRateLimit(`applications:decline_proposed:${user.id}`, 20, 60);
        if (!declineProposedRate.allowed) {
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

        if (application.applicantId !== user.id) {
            return toApplicationFailure(traceId, 'FORBIDDEN', 'Only the applicant can decline a proposed role change');
        }

        if (application.status !== 'proposed') {
            return toApplicationFailure(traceId, 'INVALID_STATE', 'This application does not have a proposed role change to decline');
        }

        await db.transaction(async (tx) => {
            // Revert back to pending, clear proposedRoleId
            await tx
                .update(roleApplications)
                .set({
                    status: 'pending',
                    proposedRoleId: null,
                    decisionBy: null,
                    decisionAt: null,
                    updatedAt: new Date(),
                })
                .where(eq(roleApplications.id, applicationId));

            await syncCanonicalApplicationMessageDecisionInternal(tx, {
                applicationId,
                conversationId: application.conversationId,
                status: 'pending',
                decisionBy: user.id,
                reason: 'proposal_declined_by_applicant',
                applicationTraceId: traceId,
            });

            if (application.conversationId) {
                await sendApplicationStatusUpdateInternal(
                    tx,
                    application.conversationId,
                    user.id,
                    applicationId,
                    application.projectId,
                    application.roleId || "",
                    application.project?.title || 'Project',
                    application.role?.title || application.role?.role || 'Original Role',
                    'pending',
                    'Applicant declined the proposed role change. Reverted to original role application.',
                    'proposal_declined_by_applicant',
                    traceId
                );
            }
        });

        const slugOrId = application.project?.slug || application.projectId;
        revalidatePath(`/projects/${slugOrId}`);
        revalidatePath('/messages');
        revalidatePath('/people');

        trackApplicationEvent('apply_reopened', {
            applicationId,
            projectId: application.projectId,
            roleId: application.roleId || undefined,
            actorId: user.id,
            source: 'messages',
            applicationTraceId: traceId,
        });

        return toApplicationSuccess(traceId, { applicationId });
    } catch (error) {
        console.error('Failed to decline proposed role change:', error);
        return toApplicationFailure(traceId, 'INTERNAL_ERROR', 'Failed to decline proposed role change');
    }
}

// ============================================================================
// GET PROJECT INVITE OPTIONS (For Lead Invite Modal)
// ============================================================================
export async function getProjectInviteOptionsAction(projectId: string): Promise<{
    success: boolean;
    error?: string;
    connections: {
        id: string;
        username: string | null;
        fullName: string | null;
        avatarUrl: string | null;
        headline: string | null;
        pendingApplicationId: string | null;
        pendingApplicationRoleId: string | null;
        pendingApplicationRoleTitle: string | null;
        pendingInvitations: { id: string; roleId: string | null; roleTitle: string | null }[];
    }[];
    openRoles: {
        id: string;
        title: string;
        role: string;
        filled: number;
        count: number;
    }[];
}> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: 'Unauthorized', connections: [], openRoles: [] };

        // 1. Fetch project open roles that are not fully filled
        const openRoles = await db.query.projectOpenRoles.findMany({
            where: and(
                eq(projectOpenRoles.projectId, projectId),
                sql`${projectOpenRoles.filled} < ${projectOpenRoles.count}`
            ),
        });

        // 2. Fetch all project member user IDs (to exclude them from connections list)
        const members = await db.query.projectMembers.findMany({
            where: eq(projectMembers.projectId, projectId),
            columns: { userId: true },
        });
        const memberUserIds = new Set(members.map((m) => m.userId));

        // 3. Fetch all pending applications for this project
        const pendingApps = await db
            .select({
                id: roleApplications.id,
                applicantId: roleApplications.applicantId,
                roleId: roleApplications.roleId,
                roleTitle: projectOpenRoles.title,
            })
            .from(roleApplications)
            .leftJoin(projectOpenRoles, eq(projectOpenRoles.id, roleApplications.roleId))
            .where(and(
                eq(roleApplications.projectId, projectId),
                eq(roleApplications.status, 'pending')
            ));

        const pendingAppsByApplicant = new Map(
            pendingApps.map((app) => [app.applicantId, app])
        );

        // 3b. Fetch all pending invitations for this project
        const pendingInvites = await db
            .select({
                id: messageWorkflowItems.id,
                assigneeUserId: messageWorkflowItems.assigneeUserId,
                roleId: sql<string | null>`${messageWorkflowItems.payload}->>'roleId'`,
                roleTitle: sql<string | null>`${messageWorkflowItems.payload}->>'roleTitle'`,
            })
            .from(messageWorkflowItems)
            .where(and(
                eq(messageWorkflowItems.projectId, projectId),
                eq(messageWorkflowItems.kind, 'project_invite'),
                eq(messageWorkflowItems.status, 'pending')
            ));

        const pendingInvitesByAssignee = new Map<string, Array<{ id: string; roleId: string | null; roleTitle: string | null }>>();
        for (const invite of pendingInvites) {
            if (invite.assigneeUserId) {
                const list = pendingInvitesByAssignee.get(invite.assigneeUserId) || [];
                list.push({ id: invite.id, roleId: invite.roleId, roleTitle: invite.roleTitle });
                pendingInvitesByAssignee.set(invite.assigneeUserId, list);
            }
        }

        // 4. Fetch all accepted connections of the user
        const connectionRows = await db
            .select({
                id: connections.id,
                requesterId: connections.requesterId,
                addresseeId: connections.addresseeId,
                profileId: profiles.id,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
                headline: profiles.headline,
            })
            .from(connections)
            .innerJoin(
                profiles,
                or(
                    and(
                        eq(connections.requesterId, user.id),
                        eq(connections.addresseeId, profiles.id)
                    ),
                    and(
                        eq(connections.addresseeId, user.id),
                        eq(connections.requesterId, profiles.id)
                    )
                )
            )
            .where(
                and(
                    eq(connections.status, 'accepted'),
                    or(eq(connections.requesterId, user.id), eq(connections.addresseeId, user.id))
                )
            );

        // Map and filter out existing members
        const filteredConnections = connectionRows
            .filter((row) => !memberUserIds.has(row.profileId))
            .map((row) => {
                const pendingApp = pendingAppsByApplicant.get(row.profileId);
                const connectionPendingInvites = pendingInvitesByAssignee.get(row.profileId) || [];
                return {
                    id: row.profileId,
                    username: row.username,
                    fullName: row.fullName,
                    avatarUrl: row.avatarUrl,
                    headline: row.headline,
                    pendingApplicationId: pendingApp?.id || null,
                    pendingApplicationRoleId: pendingApp?.roleId || null,
                    pendingApplicationRoleTitle: pendingApp?.roleTitle || null,
                    pendingInvitations: connectionPendingInvites,
                };
            });

        return {
            success: true,
            connections: filteredConnections,
            openRoles: openRoles.map((r) => ({
                id: r.id,
                title: r.title || r.role || 'Role',
                role: r.role || 'member',
                filled: r.filled || 0,
                count: r.count || 0,
            })),
        };
    } catch (error) {
        console.error('Failed to fetch project invite options:', error);
        return { success: false, error: 'Internal server error', connections: [], openRoles: [] };
    }
}
