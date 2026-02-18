'use server';

import { db } from '@/lib/db';
import {
    tasks,
    projects,
    projectMembers,
    projectSprints,
    connections,
    profiles,
    roleApplications,
} from '@/lib/db/schema';
import { createClient } from '@/lib/supabase/server';
import { eq, and, ne, or, inArray, sql, lt, desc, lte } from 'drizzle-orm';
import { getConversations, type ConversationWithDetails } from './messaging';
import { getPendingRequests } from './connections';
import { getInboxApplicationsAction } from './applications';
import { workspaceLayoutSchema } from '@/components/workspace/dashboard/validation';
import type { WorkspaceLayout } from '@/components/workspace/dashboard/types';

// ============================================================================
// TYPES
// ============================================================================

export interface WorkspaceTask {
    id: string;
    title: string;
    status: string;
    priority: string;
    dueDate: Date | null;
    taskNumber: number | null;
    projectId: string;
    projectTitle: string;
    projectSlug: string | null;
    projectKey: string | null;
    createdAt: Date;
}

export interface WorkspaceProject {
    id: string;
    title: string;
    shortDescription: string | null;
    slug: string | null;
    key: string | null;
    status: string | null;
    coverImage: string | null;
    currentStageIndex: number | null;
    role: string;
    openTaskCount: number;
    totalTaskCount: number;
    activeSprintTitle: string | null;
}

export interface RecentActivityItem {
    id: string;
    type: 'task_assigned' | 'comment_added' | 'connection_accepted' | 'application_decided';
    title: string;
    subtitle: string;
    timestamp: Date;
    meta: { projectSlug?: string | null; projectKey?: string | null; taskNumber?: number | null };
}

export interface WorkspaceOverviewData {
    tasks: WorkspaceTask[];
    projects: WorkspaceProject[];
    conversations: ConversationWithDetails[];
    tasksDueCount: number;
    inboxCount: number;
    recentActivity: RecentActivityItem[];
    workspaceLayout: WorkspaceLayout | null;
}

// ============================================================================
// HELPER: Get authenticated user
// ============================================================================

async function getAuthUser() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

const WORKSPACE_TASK_DEFAULT_LIMIT = 20;
const WORKSPACE_TASK_MAX_LIMIT = 100;
const WORKSPACE_INBOX_DEFAULT_LIMIT = 10;
const WORKSPACE_INBOX_MAX_LIMIT = 50;
const WORKSPACE_INBOX_FETCH_PADDING = 5;
const WORKSPACE_INBOX_MAX_OFFSET = 100_000;

type WorkspaceInboxCursorState = {
    pendingOffset: number;
    applicationOffset: number;
};

function normalizePositiveInt(value: unknown, fallback: number, max: number) {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    const normalized = Math.trunc(numeric);
    if (normalized < 1) return fallback;
    return Math.min(normalized, max);
}

function normalizeOffset(value: unknown, fallback: number = 0) {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    const normalized = Math.trunc(numeric);
    if (normalized < 0) return fallback;
    return Math.min(normalized, WORKSPACE_INBOX_MAX_OFFSET);
}

function parseCursorDate(cursor?: string) {
    if (!cursor) return { ok: true as const, value: null as Date | null };
    const parsed = new Date(cursor);
    if (Number.isNaN(parsed.getTime())) {
        return { ok: false as const, value: null as Date | null };
    }
    return { ok: true as const, value: parsed };
}

function parseWorkspaceInboxCursor(cursor?: string): WorkspaceInboxCursorState {
    if (!cursor) {
        return { pendingOffset: 0, applicationOffset: 0 };
    }

    try {
        const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded) as Partial<WorkspaceInboxCursorState>;
        return {
            pendingOffset: normalizeOffset(parsed.pendingOffset),
            applicationOffset: normalizeOffset(parsed.applicationOffset),
        };
    } catch {
        const legacyOffset = normalizeOffset(cursor, 0);
        return { pendingOffset: legacyOffset, applicationOffset: legacyOffset };
    }
}

function encodeWorkspaceInboxCursor(cursor: WorkspaceInboxCursorState) {
    return Buffer.from(JSON.stringify(cursor), 'utf-8').toString('base64');
}

// ============================================================================
// getWorkspaceOverview — Server-prefetch for the Overview tab
// Runs 4 parallel queries in a single round trip to the DB pool.
// ============================================================================

export async function getWorkspaceOverview(): Promise<{
    success: boolean;
    error?: string;
    data?: WorkspaceOverviewData;
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const now = new Date();
        const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        const taskCountsByProject = db
            .select({
                projectId: tasks.projectId,
                openTaskCount: sql<number>`count(*) FILTER (WHERE ${tasks.status} != 'done')::int`.as('open_task_count'),
                totalTaskCount: sql<number>`count(*)::int`.as('total_task_count'),
            })
            .from(tasks)
            .groupBy(tasks.projectId)
            .as('task_counts_by_project');

        const activeSprintByProject = db
            .select({
                projectId: projectSprints.projectId,
                activeSprintTitle: sql<string | null>`max(${projectSprints.name})`.as('active_sprint_title'),
            })
            .from(projectSprints)
            .where(eq(projectSprints.status, 'active'))
            .groupBy(projectSprints.projectId)
            .as('active_sprint_by_project');

        const [myTasks, myProjects, convResult, dueCountResult, inboxCountResult, recentActivity, layoutResult] = await Promise.all([
            // Query 1: My active tasks across all projects (JOIN, single query)
            db
                .select({
                    id: tasks.id,
                    title: tasks.title,
                    status: tasks.status,
                    priority: tasks.priority,
                    dueDate: tasks.dueDate,
                    taskNumber: tasks.taskNumber,
                    projectId: tasks.projectId,
                    createdAt: tasks.createdAt,
                    projectTitle: projects.title,
                    projectSlug: projects.slug,
                    projectKey: projects.key,
                })
                .from(tasks)
                .innerJoin(projects, eq(tasks.projectId, projects.id))
                .where(
                    and(
                        eq(tasks.assigneeId, user.id),
                        inArray(tasks.status, ['todo', 'in_progress']),
                    )
                )
                .orderBy(
                    sql`CASE ${tasks.priority} WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END`,
                    sql`${tasks.dueDate} ASC NULLS LAST`
                )
                .limit(10),

            // Query 2: My projects with open task counts and active sprint
            db
                .select({
                    id: projects.id,
                    title: projects.title,
                    shortDescription: projects.shortDescription,
                    slug: projects.slug,
                    key: projects.key,
                    status: projects.status,
                    coverImage: projects.coverImage,
                    currentStageIndex: projects.currentStageIndex,
                    role: projectMembers.role,
                    openTaskCount: sql<number>`COALESCE(${taskCountsByProject.openTaskCount}, 0)::int`,
                    totalTaskCount: sql<number>`COALESCE(${taskCountsByProject.totalTaskCount}, 0)::int`,
                    activeSprintTitle: activeSprintByProject.activeSprintTitle,
                })
                .from(projectMembers)
                .innerJoin(projects, eq(projectMembers.projectId, projects.id))
                .leftJoin(taskCountsByProject, eq(taskCountsByProject.projectId, projects.id))
                .leftJoin(activeSprintByProject, eq(activeSprintByProject.projectId, projects.id))
                .where(
                    and(
                        eq(projectMembers.userId, user.id),
                        ne(projects.status, 'archived'),
                    )
                )
                .orderBy(desc(projectMembers.joinedAt)),

            // Query 3: Recent conversations (reuse existing optimized action, limit 5)
            getConversations(5),

            // Query 4: Tasks due today count (single aggregate, instant)
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(tasks)
                .where(
                    and(
                        eq(tasks.assigneeId, user.id),
                        ne(tasks.status, 'done'),
                        lte(tasks.dueDate, todayEnd),
                    )
                ),

            // Query 5: Pending inbox count (connections waiting for user)
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(connections)
                .where(
                    and(
                        eq(connections.addresseeId, user.id),
                        eq(connections.status, 'pending'),
                    )
                ),

            // Query 6: Recent activity (events from others that affect this user)
            getRecentActivityForOverview(user.id),

            // Query 7: Workspace layout (single column from profiles, PK lookup — O(1))
            db
                .select({ workspaceLayout: profiles.workspaceLayout })
                .from(profiles)
                .where(eq(profiles.id, user.id))
                .limit(1),
        ]);

        return {
            success: true,
            data: {
                tasks: myTasks as WorkspaceTask[],
                projects: myProjects as WorkspaceProject[],
                conversations: convResult.conversations ?? [],
                tasksDueCount: dueCountResult[0]?.count ?? 0,
                inboxCount: inboxCountResult[0]?.count ?? 0,
                recentActivity,
                workspaceLayout: (layoutResult[0]?.workspaceLayout as WorkspaceLayout | null) ?? null,
            },
        };
    } catch (error) {
        console.error('[getWorkspaceOverview] Error:', error);
        return { success: false, error: 'Failed to load workspace data' };
    }
}

// ============================================================================
// getRecentActivityForOverview — "What's happening around me" feed
// Events that affect the user from others (not self-log).
// 4 parallel queries, all leveraging existing indexes.
// ============================================================================

export async function getRecentActivityForOverview(userId: string): Promise<RecentActivityItem[]> {
    try {
        const supabase = await createClient();

        // Each query is wrapped in its own catch so one failure doesn't crash the others
        const safe = <T>(promise: PromiseLike<T>, fallback: T) => Promise.resolve(promise).catch(() => fallback);

        const [assignedRows, commentResult, connectionRows, applicationRows] = await Promise.all([
            // 1. Tasks recently assigned to me by others (uses tasks_assignee_idx)
            safe(
                db
                    .select({
                        id: tasks.id,
                        title: tasks.title,
                        updatedAt: tasks.updatedAt,
                        taskNumber: tasks.taskNumber,
                        creatorName: profiles.fullName,
                        creatorUsername: profiles.username,
                        projectTitle: projects.title,
                        projectSlug: projects.slug,
                        projectKey: projects.key,
                    })
                    .from(tasks)
                    .innerJoin(projects, eq(tasks.projectId, projects.id))
                    .innerJoin(profiles, eq(tasks.creatorId, profiles.id))
                    .where(
                        and(
                            eq(tasks.assigneeId, userId),
                            ne(tasks.creatorId, userId),
                        )
                    )
                    .orderBy(desc(tasks.updatedAt))
                    .limit(5),
                [] as any[]
            ),

            // 2. Comments on my tasks by others (uses idx_task_comments_created_at)
            safe(
                supabase
                    .from('task_comments')
                    .select(`
                        id,
                        created_at,
                        content,
                        user_profile:profiles!task_comments_user_id_fkey(full_name, username),
                        task:tasks!inner(id, title, task_number, project_id, assignee_id,
                            project:projects!tasks_project_id_fkey(title, slug, key)
                        )
                    `)
                    .eq('task.assignee_id', userId)
                    .neq('user_id', userId)
                    .order('created_at', { ascending: false })
                    .limit(8),
                { data: null, error: null, count: null, status: 500, statusText: 'fallback' } as any
            ),

            // 3. Connections accepted (uses connections_requester_stats_idx / connections_addressee_stats_idx)
            safe(
                db
                    .select({
                        id: connections.id,
                        updatedAt: connections.updatedAt,
                        peerName: profiles.fullName,
                        peerUsername: profiles.username,
                    })
                    .from(connections)
                    .innerJoin(
                        profiles,
                        sql`CASE WHEN ${connections.requesterId} = ${userId} THEN ${connections.addresseeId} ELSE ${connections.requesterId} END = ${profiles.id}`
                    )
                    .where(
                        and(
                            eq(connections.status, 'accepted'),
                            or(
                                eq(connections.requesterId, userId),
                                eq(connections.addresseeId, userId),
                            ),
                        )
                    )
                    .orderBy(desc(connections.updatedAt))
                    .limit(3),
                [] as any[]
            ),

            // 4. Application decisions on my applications (uses role_applications_applicant_idx)
            safe(
                db
                    .select({
                        id: roleApplications.id,
                        status: roleApplications.status,
                        updatedAt: roleApplications.updatedAt,
                        acceptedRoleTitle: roleApplications.acceptedRoleTitle,
                        projectTitle: projects.title,
                        projectSlug: projects.slug,
                        projectKey: projects.key,
                    })
                    .from(roleApplications)
                    .innerJoin(projects, eq(roleApplications.projectId, projects.id))
                    .where(
                        and(
                            eq(roleApplications.applicantId, userId),
                            inArray(roleApplications.status, ['accepted', 'rejected']),
                        )
                    )
                    .orderBy(desc(roleApplications.updatedAt))
                    .limit(3),
                [] as any[]
            ),
        ]);

        const items: RecentActivityItem[] = [];

        // Map assigned tasks
        for (const row of assignedRows) {
            const assignerName = row.creatorName || row.creatorUsername || 'Someone';
            items.push({
                id: `assign-${row.id}`,
                type: 'task_assigned',
                title: row.title,
                subtitle: `Assigned by ${assignerName}`,
                timestamp: row.updatedAt,
                meta: { projectSlug: row.projectSlug, projectKey: row.projectKey, taskNumber: row.taskNumber },
            });
        }

        // Map comments — filter to only comments on my tasks
        if (commentResult.data) {
            for (const c of commentResult.data) {
                const task = c.task as { id: string; title: string; task_number: number | null; assignee_id: string | null; project: { title: string; slug: string | null; key: string | null } } | null;
                if (!task) continue;
                const commenterName = (c.user_profile as { full_name?: string; username?: string } | null)?.full_name
                    || (c.user_profile as { full_name?: string; username?: string } | null)?.username
                    || 'Someone';
                items.push({
                    id: `comment-${c.id}`,
                    type: 'comment_added',
                    title: task.title,
                    subtitle: `${commenterName} commented`,
                    timestamp: new Date(c.created_at),
                    meta: { projectSlug: task.project?.slug, projectKey: task.project?.key, taskNumber: task.task_number },
                });
                if (items.filter(i => i.type === 'comment_added').length >= 5) break;
            }
        }

        // Map connections
        for (const row of connectionRows) {
            const peerName = row.peerName || row.peerUsername || 'Someone';
            items.push({
                id: `conn-${row.id}`,
                type: 'connection_accepted',
                title: `Connected with ${peerName}`,
                subtitle: 'New connection',
                timestamp: row.updatedAt,
                meta: {},
            });
        }

        // Map application decisions
        for (const row of applicationRows) {
            const decided = row.status === 'accepted' ? 'accepted' : 'declined';
            items.push({
                id: `app-${row.id}`,
                type: 'application_decided',
                title: row.acceptedRoleTitle || row.projectTitle,
                subtitle: `Application ${decided} in ${row.projectTitle}`,
                timestamp: row.updatedAt,
                meta: { projectSlug: row.projectSlug, projectKey: row.projectKey },
            });
        }

        // Sort by timestamp, return top 6
        items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        return items.slice(0, 6);
    } catch (error) {
        console.error('[getRecentActivityForOverview] Error:', error);
        return [];
    }
}

// ============================================================================
// getWorkspaceTasks — Cross-project task list with cursor pagination
// ============================================================================

export interface WorkspaceTaskFilters {
    status?: 'todo' | 'in_progress' | 'done' | 'blocked';
    priority?: 'low' | 'medium' | 'high' | 'urgent';
    projectId?: string;
}

export async function getWorkspaceTasks(
    filters: WorkspaceTaskFilters = {},
    cursor?: string,
    limit: number = WORKSPACE_TASK_DEFAULT_LIMIT
): Promise<{
    success: boolean;
    error?: string;
    tasks?: WorkspaceTask[];
    hasMore?: boolean;
    nextCursor?: string;
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        const safeLimit = normalizePositiveInt(limit, WORKSPACE_TASK_DEFAULT_LIMIT, WORKSPACE_TASK_MAX_LIMIT);
        const parsedCursor = parseCursorDate(cursor);
        if (!parsedCursor.ok) {
            return { success: false, error: 'Invalid cursor' };
        }

        const conditions = [eq(tasks.assigneeId, user.id)];

        if (filters.status) {
            conditions.push(eq(tasks.status, filters.status));
        }
        if (filters.priority) {
            conditions.push(eq(tasks.priority, filters.priority));
        }
        if (filters.projectId) {
            conditions.push(eq(tasks.projectId, filters.projectId));
        }
        if (parsedCursor.value) {
            conditions.push(lt(tasks.createdAt, parsedCursor.value));
        }

        const rows = await db
            .select({
                id: tasks.id,
                title: tasks.title,
                status: tasks.status,
                priority: tasks.priority,
                dueDate: tasks.dueDate,
                taskNumber: tasks.taskNumber,
                projectId: tasks.projectId,
                createdAt: tasks.createdAt,
                projectTitle: projects.title,
                projectSlug: projects.slug,
                projectKey: projects.key,
            })
            .from(tasks)
            .innerJoin(projects, eq(tasks.projectId, projects.id))
            .where(and(...conditions))
            .orderBy(desc(tasks.createdAt))
            .limit(safeLimit + 1);

        const hasMore = rows.length > safeLimit;
        const paginated = rows.slice(0, safeLimit);
        const nextCursor = hasMore ? paginated[paginated.length - 1]?.createdAt?.toISOString() : undefined;

        return {
            success: true,
            tasks: paginated as WorkspaceTask[],
            hasMore,
            nextCursor,
        };
    } catch (error) {
        console.error('[getWorkspaceTasks] Error:', error);
        return { success: false, error: 'Failed to load tasks' };
    }
}

// ============================================================================
// getWorkspaceInbox — Unified inbox (pending requests + applications)
// ============================================================================

export interface WorkspaceInboxItem {
    id: string;
    type: 'connection_request' | 'application';
    title: string;
    subtitle: string;
    avatarUrl: string | null;
    createdAt: Date;
    meta: Record<string, unknown>;
}

export async function getWorkspaceInbox(
    cursor?: string,
    limit: number = WORKSPACE_INBOX_DEFAULT_LIMIT
): Promise<{
    success: boolean;
    error?: string;
    items?: WorkspaceInboxItem[];
    hasMore?: boolean;
    nextCursor?: string;
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        const safeLimit = normalizePositiveInt(limit, WORKSPACE_INBOX_DEFAULT_LIMIT, WORKSPACE_INBOX_MAX_LIMIT);
        const cursorState = parseWorkspaceInboxCursor(cursor);

        // Fetch slightly more than limit from each source to support stable merge pagination.
        const fetchLimit = safeLimit + WORKSPACE_INBOX_FETCH_PADDING;

        const [pendingResult, applicationsResult] = await Promise.all([
            getPendingRequests(fetchLimit, cursorState.pendingOffset),
            getInboxApplicationsAction(fetchLimit, cursorState.applicationOffset),
        ]);

        type SourcedInboxItem = WorkspaceInboxItem & { source: 'pending' | 'application' };
        const items: SourcedInboxItem[] = [];

        // Map connection requests
        if (pendingResult.incoming) {
            for (const req of pendingResult.incoming) {
                items.push({
                    id: req.id,
                    type: 'connection_request',
                    title: req.requesterFullName || req.requesterUsername || 'Someone',
                    subtitle: req.requesterHeadline || 'wants to connect',
                    avatarUrl: req.requesterAvatarUrl || null,
                    createdAt: req.createdAt,
                    meta: { connectionId: req.id, requesterId: req.requesterId },
                    source: 'pending',
                });
            }
        }

        // Map applications
        if (applicationsResult.applications) {
            for (const app of applicationsResult.applications) {
                items.push({
                    id: app.id,
                    type: 'application',
                    title: app.displayUser?.fullName || app.displayUser?.username || 'Someone',
                    subtitle: `${app.type === 'incoming' ? 'Applied to' : 'Your application for'} ${app.roleTitle} in ${app.projectTitle}`,
                    avatarUrl: app.displayUser?.avatarUrl || null,
                    createdAt: app.createdAt,
                    meta: {
                        applicationId: app.id,
                        projectSlug: app.projectSlug,
                        applicationType: app.type,
                        status: app.status,
                        conversationId: app.conversationId,
                    },
                    source: 'application',
                });
            }
        }

        // Sort unified list by most recent first, tie-break by id for stable pagination.
        items.sort((a, b) => {
            const byTime = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            if (byTime !== 0) return byTime;
            return b.id.localeCompare(a.id);
        });

        const hasMoreCombined = items.length > safeLimit;
        const paginated = items.slice(0, safeLimit);
        const consumedPending = paginated.filter((item) => item.source === 'pending').length;
        const consumedApplications = paginated.filter((item) => item.source === 'application').length;
        const hasMoreSource = Boolean(pendingResult.hasMoreIncoming || applicationsResult.hasMore);
        const hasMore = hasMoreCombined || hasMoreSource;
        const nextCursor = hasMore
            ? encodeWorkspaceInboxCursor({
                pendingOffset: cursorState.pendingOffset + consumedPending,
                applicationOffset: cursorState.applicationOffset + consumedApplications,
            })
            : undefined;

        return {
            success: true,
            items: paginated.map(({ source: _source, ...item }) => item),
            hasMore,
            nextCursor,
        };
    } catch (error) {
        console.error('[getWorkspaceInbox] Error:', error);
        return { success: false, error: 'Failed to load inbox' };
    }
}

// ============================================================================
// getWorkspaceActivity — Personal activity stream (recently updated tasks)
// ============================================================================

export interface WorkspaceActivityItem {
    id: string;
    type: 'task_completed' | 'task_in_progress' | 'task_created' | 'connection_accepted';
    title: string;
    subtitle: string;
    timestamp: Date;
    meta: { projectSlug?: string | null; projectKey?: string | null; taskNumber?: number | null };
}

export async function getWorkspaceActivity(limit: number = 15): Promise<{
    success: boolean;
    error?: string;
    items?: WorkspaceActivityItem[];
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        // Parallel: task activity + accepted connections
        const [taskRows, connectionRows] = await Promise.all([
            db
                .select({
                    id: tasks.id,
                    title: tasks.title,
                    status: tasks.status,
                    updatedAt: tasks.updatedAt,
                    taskNumber: tasks.taskNumber,
                    projectTitle: projects.title,
                    projectSlug: projects.slug,
                    projectKey: projects.key,
                })
                .from(tasks)
                .innerJoin(projects, eq(tasks.projectId, projects.id))
                .where(eq(tasks.assigneeId, user.id))
                .orderBy(desc(tasks.updatedAt))
                .limit(limit),

            db
                .select({
                    id: connections.id,
                    updatedAt: connections.updatedAt,
                    requesterId: connections.requesterId,
                    addresseeId: connections.addresseeId,
                    peerName: profiles.fullName,
                    peerUsername: profiles.username,
                })
                .from(connections)
                .innerJoin(
                    profiles,
                    sql`CASE WHEN ${connections.requesterId} = ${user.id} THEN ${connections.addresseeId} ELSE ${connections.requesterId} END = ${profiles.id}`
                )
                .where(
                    and(
                        eq(connections.status, 'accepted'),
                        or(
                            eq(connections.requesterId, user.id),
                            eq(connections.addresseeId, user.id),
                        ),
                    )
                )
                .orderBy(desc(connections.updatedAt))
                .limit(5),
        ]);

        const items: WorkspaceActivityItem[] = [];

        // Map task rows
        for (const row of taskRows) {
            const type: WorkspaceActivityItem['type'] =
                row.status === 'done' ? 'task_completed' :
                row.status === 'in_progress' ? 'task_in_progress' :
                'task_created';

            const verb = type === 'task_completed' ? 'Completed' : type === 'task_in_progress' ? 'Started' : 'Created';

            items.push({
                id: row.id,
                type,
                title: row.title,
                subtitle: `${verb} in ${row.projectTitle}`,
                timestamp: row.updatedAt,
                meta: { projectSlug: row.projectSlug, projectKey: row.projectKey, taskNumber: row.taskNumber },
            });
        }

        // Map connection rows
        for (const row of connectionRows) {
            const peerName = row.peerName || row.peerUsername || 'Someone';
            items.push({
                id: `conn-${row.id}`,
                type: 'connection_accepted',
                title: `Connected with ${peerName}`,
                subtitle: 'New connection',
                timestamp: row.updatedAt,
                meta: {},
            });
        }

        // Merge and sort by timestamp, take top N
        items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        return { success: true, items: items.slice(0, limit) };
    } catch (error) {
        console.error('[getWorkspaceActivity] Error:', error);
        return { success: false, error: 'Failed to load activity' };
    }
}

// ============================================================================
// saveWorkspaceLayout — Persist the user's custom dashboard layout
// Single UPDATE on PK — O(1), works at 1M+ scale.
// ============================================================================

export async function saveWorkspaceLayout(
    layout: WorkspaceLayout | null
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        // Validate layout structure if not null
        if (layout !== null) {
            const parsed = workspaceLayoutSchema.safeParse(layout);
            if (!parsed.success) {
                return { success: false, error: 'Invalid layout data' };
            }
        }

        await db
            .update(profiles)
            .set({ workspaceLayout: layout })
            .where(eq(profiles.id, user.id));

        return { success: true };
    } catch (error) {
        console.error('[saveWorkspaceLayout] Error:', error);
        return { success: false, error: 'Failed to save layout' };
    }
}
