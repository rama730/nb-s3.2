'use server';

import { createHmac } from 'crypto';
import { db } from '@/lib/db';
import {
    tasks,
    projects,
    projectMembers,
    projectSprints,
    projectNodes,
    connections,
    profiles,
    roleApplications,
} from '@/lib/db/schema';
import { createClient } from '@/lib/supabase/server';
import { eq, and, ne, or, inArray, sql, lt, desc, lte, isNull } from 'drizzle-orm';
import { getConversations } from './messaging/_all';
import type { ConversationWithDetails } from './messaging/_all';
import { getPendingRequests } from './connections';
import { getInboxApplicationsAction, getIncomingApplicationsAction } from './applications';
import { workspaceLayoutSchema } from '@/components/workspace/dashboard/validation';
import { DEFAULT_LAYOUT, WORKSPACE_LAYOUT_VERSION } from '@/components/workspace/dashboard/types';
import type { WorkspaceLayout, WorkspacePinnedItem } from '@/components/workspace/dashboard/types';
import { runInFlightDeduped } from '@/lib/async/inflight-dedupe';

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

export interface WorkspaceProjectRef {
    id: string;
    title: string;
    slug: string | null;
    key: string | null;
}

export interface WorkspaceOverviewBaseData {
    workspaceLayout: WorkspaceLayout | null;
    tasksDueCount: number;
    inboxCount: number;
    overdueCount: number;
    inProgressCount: number;
    projectRefs: WorkspaceProjectRef[];
}

export interface WorkspaceRecentFile {
    id: string;
    projectId: string;
    projectTitle: string;
    projectSlug: string | null;
    projectKey: string | null;
    name: string;
    path: string;
    mimeType: string | null;
    size: number | null;
    updatedAt: Date;
}

export interface WorkspaceMentionsRequestItem {
    id: string;
    type: 'connection_request' | 'application_request';
    title: string;
    subtitle: string;
    createdAt: Date;
    avatarUrl: string | null;
    route: string;
}

export interface WorkspacePreferencesData {
    notes: { content: string; updatedAt: string } | null;
    pins: WorkspacePinnedItem[];
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

const WORKSPACE_METRIC_HASH_SECRET =
    process.env.WORKSPACE_METRIC_HASH_SECRET?.trim()
    || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    || process.env.DATABASE_URL?.trim()
    || 'workspace-metric-hash-fallback';

function anonymizeWorkspaceMetricUserId(userId: string): string {
    return createHmac('sha256', WORKSPACE_METRIC_HASH_SECRET)
        .update(userId)
        .digest('hex')
        .slice(0, 16);
}

function logWorkspaceMetric(name: string, startMs: number, userId: string) {
    const durationMs = Math.round(performance.now() - startMs);
    console.info(`[workspace-metric] ${name}`, {
        userHash: anonymizeWorkspaceMetricUserId(userId),
        durationMs,
    });
}

function parseWorkspaceLayout(raw: unknown): WorkspaceLayout {
    const parsed = workspaceLayoutSchema.safeParse(raw);
    if (!parsed.success) return DEFAULT_LAYOUT;
    const layout = parsed.data as WorkspaceLayout;
    const seen = new Set<string>();
    const widgets = layout.widgets
        .map((widget) => ({
            ...widget,
            widgetId: widget.widgetId === 'shortcuts' ? 'quick_actions' : widget.widgetId,
        }))
        .filter((widget) => {
            if (seen.has(widget.widgetId)) return false;
            seen.add(widget.widgetId);
            return true;
        });
    return {
        ...layout,
        version: layout.version < WORKSPACE_LAYOUT_VERSION ? WORKSPACE_LAYOUT_VERSION : layout.version,
        widgets,
    };
}

function sanitizePins(raw: unknown): WorkspacePinnedItem[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((item): item is WorkspacePinnedItem => {
            if (!item || typeof item !== 'object') return false;
            const pin = item as Partial<WorkspacePinnedItem>;
            if (!pin.id || typeof pin.id !== 'string') return false;
            if (!pin.title || typeof pin.title !== 'string') return false;
            if (pin.type !== 'task' && pin.type !== 'project') return false;
            if (pin.type === 'task' && (!pin.projectId || typeof pin.projectId !== 'string')) return false;
            return true;
        })
        .slice(0, 10);
}

export async function getWorkspaceOverviewBase(): Promise<{
    success: boolean;
    error?: string;
    data?: WorkspaceOverviewBaseData;
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        return await runInFlightDeduped(`workspace:overview-base:${user.id}`, async () => {
            const startedAt = performance.now();
            const [profileRows, projectRefsRows] = await Promise.all([
                db
                    .select({
                        workspaceLayout: profiles.workspaceLayout,
                        workspaceInboxCount: profiles.workspaceInboxCount,
                        workspaceDueTodayCount: profiles.workspaceDueTodayCount,
                        workspaceOverdueCount: profiles.workspaceOverdueCount,
                        workspaceInProgressCount: profiles.workspaceInProgressCount,
                    })
                    .from(profiles)
                    .where(eq(profiles.id, user.id))
                    .limit(1),
                db
                    .select({
                        id: projects.id,
                        title: projects.title,
                        slug: projects.slug,
                        key: projects.key,
                    })
                    .from(projectMembers)
                    .innerJoin(projects, eq(projectMembers.projectId, projects.id))
                    .where(
                        and(
                            eq(projectMembers.userId, user.id),
                            ne(projects.status, 'archived'),
                        )
                    )
                    .orderBy(desc(projectMembers.joinedAt))
                    .limit(40),
            ]);

            const profileRow = profileRows[0];
            const rawLayout = profileRow?.workspaceLayout;
            const layout = rawLayout ? parseWorkspaceLayout(rawLayout) : null;

            logWorkspaceMetric('workspace.base.fetch_ms', startedAt, user.id);
            return {
                success: true,
                data: {
                    workspaceLayout: layout,
                    tasksDueCount: profileRow?.workspaceDueTodayCount ?? 0,
                    inboxCount: profileRow?.workspaceInboxCount ?? 0,
                    overdueCount: profileRow?.workspaceOverdueCount ?? 0,
                    inProgressCount: profileRow?.workspaceInProgressCount ?? 0,
                    projectRefs: projectRefsRows,
                },
            };
        });
    } catch (error) {
        console.error('[getWorkspaceOverviewBase] Error:', error);
        return { success: false, error: 'Failed to load workspace base data' };
    }
}

export async function getWorkspaceOverviewTasksSection(limit: number = 12): Promise<{
    success: boolean;
    error?: string;
    tasks?: WorkspaceTask[];
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        const safeLimit = normalizePositiveInt(limit, 12, 50);
        return await runInFlightDeduped(`workspace:overview:tasks:${user.id}:${safeLimit}`, async () => {
            const startedAt = performance.now();
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
                .limit(safeLimit);

            logWorkspaceMetric('workspace.section.tasks_ms', startedAt, user.id);
            return { success: true, tasks: rows as WorkspaceTask[] };
        });
    } catch (error) {
        console.error('[getWorkspaceOverviewTasksSection] Error:', error);
        return { success: false, error: 'Failed to load tasks section' };
    }
}

export async function getWorkspaceOverviewProjectsSection(limit: number = 12): Promise<{
    success: boolean;
    error?: string;
    projects?: WorkspaceProject[];
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        const safeLimit = normalizePositiveInt(limit, 12, 40);
        return await runInFlightDeduped(`workspace:overview:projects:${user.id}:${safeLimit}`, async () => {
            const startedAt = performance.now();
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

            const rows = await db
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
                .orderBy(desc(projectMembers.joinedAt))
                .limit(safeLimit);

            logWorkspaceMetric('workspace.section.projects_ms', startedAt, user.id);
            return { success: true, projects: rows as WorkspaceProject[] };
        });
    } catch (error) {
        console.error('[getWorkspaceOverviewProjectsSection] Error:', error);
        return { success: false, error: 'Failed to load projects section' };
    }
}

export async function getWorkspaceOverviewConversationsSection(limit: number = 6): Promise<{
    success: boolean;
    error?: string;
    conversations?: ConversationWithDetails[];
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const safeLimit = normalizePositiveInt(limit, 6, 30);
        return await runInFlightDeduped(`workspace:overview:conversations:${user.id}:${safeLimit}`, async () => {
            const startedAt = performance.now();
            const result = await getConversations(safeLimit);
            logWorkspaceMetric('workspace.section.conversations_ms', startedAt, user.id);
            return { success: true, conversations: result.conversations ?? [] };
        });
    } catch (error) {
        console.error('[getWorkspaceOverviewConversationsSection] Error:', error);
        return { success: false, error: 'Failed to load messages section' };
    }
}

export async function getWorkspaceOverviewRecentActivitySection(limit: number = 6): Promise<{
    success: boolean;
    error?: string;
    recentActivity?: RecentActivityItem[];
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        const safeLimit = normalizePositiveInt(limit, 6, 30);
        return await runInFlightDeduped(`workspace:overview:activity:${user.id}:${safeLimit}`, async () => {
            const startedAt = performance.now();
            const items = await getRecentActivityForOverview(user.id, safeLimit);
            logWorkspaceMetric('workspace.section.activity_ms', startedAt, user.id);
            return { success: true, recentActivity: items.slice(0, safeLimit) };
        });
    } catch (error) {
        console.error('[getWorkspaceOverviewRecentActivitySection] Error:', error);
        return { success: false, error: 'Failed to load activity section' };
    }
}

export async function getWorkspaceOverviewFilesSection(limit: number = 8): Promise<{
    success: boolean;
    error?: string;
    files?: WorkspaceRecentFile[];
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        const safeLimit = normalizePositiveInt(limit, 8, 40);
        return await runInFlightDeduped(`workspace:overview:files:${user.id}:${safeLimit}`, async () => {
            const startedAt = performance.now();
            const rows = await db
                .select({
                    id: projectNodes.id,
                    projectId: projectNodes.projectId,
                    projectTitle: projects.title,
                    projectSlug: projects.slug,
                    projectKey: projects.key,
                    name: projectNodes.name,
                    path: projectNodes.path,
                    mimeType: projectNodes.mimeType,
                    size: projectNodes.size,
                    updatedAt: projectNodes.updatedAt,
                })
                .from(projectNodes)
                .innerJoin(projects, eq(projectNodes.projectId, projects.id))
                .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
                .where(
                    and(
                        eq(projectMembers.userId, user.id),
                        eq(projectNodes.type, 'file'),
                        isNull(projectNodes.deletedAt),
                        ne(projects.status, 'archived'),
                    )
                )
                .orderBy(desc(projectNodes.updatedAt), desc(projectNodes.id))
                .limit(safeLimit);

            logWorkspaceMetric('workspace.section.files_ms', startedAt, user.id);
            return { success: true, files: rows as WorkspaceRecentFile[] };
        });
    } catch (error) {
        console.error('[getWorkspaceOverviewFilesSection] Error:', error);
        return { success: false, error: 'Failed to load files section' };
    }
}

export async function getWorkspaceOverviewMentionsSection(limit: number = 8): Promise<{
    success: boolean;
    error?: string;
    mentionsRequests?: WorkspaceMentionsRequestItem[];
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        const safeLimit = normalizePositiveInt(limit, 8, 30);
        return await runInFlightDeduped(`workspace:overview:mentions:${user.id}:${safeLimit}`, async () => {
            const startedAt = performance.now();
            const [pendingResult, applicationsResult] = await Promise.all([
                getPendingRequests(safeLimit, 0),
                getIncomingApplicationsAction(safeLimit, 0),
            ]);

            const items: WorkspaceMentionsRequestItem[] = [];

            for (const req of pendingResult.incoming ?? []) {
                items.push({
                    id: `conn-${req.id}`,
                    type: 'connection_request',
                    title: req.requesterFullName || req.requesterUsername || 'Connection request',
                    subtitle: 'Sent you a connection request',
                    createdAt: new Date(req.createdAt),
                    avatarUrl: req.requesterAvatarUrl || null,
                    route: '/people?tab=requests',
                });
            }

            for (const app of applicationsResult.applications ?? []) {
                if (app.status !== 'pending') continue;
                items.push({
                    id: `app-${app.id}`,
                    type: 'application_request',
                    title: app.applicant.fullName || app.applicant.username || 'Application request',
                    subtitle: `${app.roleTitle} · ${app.projectTitle}`,
                    createdAt: new Date(app.createdAt),
                    avatarUrl: app.applicant.avatarUrl || null,
                    route: '/people?tab=requests',
                });
            }

            items.sort((a, b) => {
                const byTime = b.createdAt.getTime() - a.createdAt.getTime();
                if (byTime !== 0) return byTime;
                return b.id.localeCompare(a.id);
            });
            logWorkspaceMetric('workspace.section.mentions_requests_ms', startedAt, user.id);
            return { success: true, mentionsRequests: items.slice(0, safeLimit) };
        });
    } catch (error) {
        console.error('[getWorkspaceOverviewMentionsSection] Error:', error);
        return { success: false, error: 'Failed to load mentions and requests section' };
    }
}

// ============================================================================
// getRecentActivityForOverview — "What's happening around me" feed
// Events that affect the user from others (not self-log).
// 4 parallel queries, all leveraging existing indexes.
// ============================================================================

export async function getRecentActivityForOverview(
    userId: string,
    limit: number = 6,
): Promise<RecentActivityItem[]> {
    try {
        const supabase = await createClient();
        const safeLimit = normalizePositiveInt(limit, 6, 30);

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

        // Sort by timestamp, return top items capped by safeLimit
        items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        return items.slice(0, safeLimit);
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
        const dedupeKey = [
            'workspace:tasks',
            user.id,
            safeLimit,
            parsedCursor.value?.toISOString() ?? '',
            filters.status ?? '',
            filters.priority ?? '',
            filters.projectId ?? '',
        ].join(':');

        return await runInFlightDeduped(dedupeKey, async () => {
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
        });
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
        const dedupeKey = [
            'workspace:inbox',
            user.id,
            safeLimit,
            cursorState.pendingOffset,
            cursorState.applicationOffset,
        ].join(':');

        return await runInFlightDeduped(dedupeKey, async () => {
            // Fetch slightly more than limit from each source to support stable merge pagination.
            const fetchLimit = safeLimit + WORKSPACE_INBOX_FETCH_PADDING;

            const [pendingResult, applicationsResult] = await Promise.all([
                getPendingRequests(fetchLimit, cursorState.pendingOffset),
                getInboxApplicationsAction(fetchLimit, cursorState.applicationOffset),
            ]);

            type SourcedInboxItem = WorkspaceInboxItem & { source: 'pending' | 'application' };
            const items: SourcedInboxItem[] = [];

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
        });
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
        const safeLimit = normalizePositiveInt(limit, 15, 60);

        return await runInFlightDeduped(`workspace:activity:${user.id}:${safeLimit}`, async () => {
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
                    .limit(safeLimit),

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
                        ),
                    )
                    .orderBy(desc(connections.updatedAt))
                    .limit(5),
            ]);

            const items: WorkspaceActivityItem[] = [];

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

            items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            return { success: true, items: items.slice(0, safeLimit) };
        });
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
    const startedAt = performance.now();
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

        await db.transaction(async (tx) => {
            const current = await tx
                .select({ workspaceLayout: profiles.workspaceLayout })
                .from(profiles)
                .where(eq(profiles.id, user.id))
                .for('update')
                .limit(1);

            const currentLayout = current[0]?.workspaceLayout ? parseWorkspaceLayout(current[0].workspaceLayout) : null;
            const mergedLayout = layout
                ? {
                    ...layout,
                    quickNotes: currentLayout?.quickNotes,
                    pins: currentLayout?.pins,
                }
                : null;

            await tx
                .update(profiles)
                .set({ workspaceLayout: mergedLayout })
                .where(eq(profiles.id, user.id));
        });

        logWorkspaceMetric('workspace.layout.save_ms', startedAt, user.id);
        return { success: true };
    } catch (error) {
        console.error('[saveWorkspaceLayout] Error:', error);
        return { success: false, error: 'Failed to save layout' };
    }
}

export async function getWorkspacePreferences(): Promise<{
    success: boolean;
    error?: string;
    data?: WorkspacePreferencesData;
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        return await runInFlightDeduped(`workspace:preferences:${user.id}`, async () => {
            const rows = await db
                .select({ workspaceLayout: profiles.workspaceLayout })
                .from(profiles)
                .where(eq(profiles.id, user.id))
                .limit(1);
            const layout = rows[0]?.workspaceLayout ? parseWorkspaceLayout(rows[0].workspaceLayout) : null;

            return {
                success: true,
                data: {
                    notes: layout?.quickNotes ?? null,
                    pins: sanitizePins(layout?.pins),
                },
            };
        });
    } catch (error) {
        console.error('[getWorkspacePreferences] Error:', error);
        return { success: false, error: 'Failed to load workspace preferences' };
    }
}

export async function saveWorkspaceQuickNotes(content: string): Promise<{ success: boolean; error?: string }> {
    const startedAt = performance.now();
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        await db.transaction(async (tx) => {
            const rows = await tx
                .select({ workspaceLayout: profiles.workspaceLayout })
                .from(profiles)
                .where(eq(profiles.id, user.id))
                .for('update')
                .limit(1);
            const current = rows[0]?.workspaceLayout ? parseWorkspaceLayout(rows[0].workspaceLayout) : DEFAULT_LAYOUT;

            const normalizedContent = content.slice(0, 50_000);
            const next: WorkspaceLayout = {
                ...current,
                quickNotes: normalizedContent
                    ? { content: normalizedContent, updatedAt: new Date().toISOString() }
                    : undefined,
            };

            await tx
                .update(profiles)
                .set({ workspaceLayout: next })
                .where(eq(profiles.id, user.id));
        });

        logWorkspaceMetric('workspace.quick_notes.save_ms', startedAt, user.id);
        return { success: true };
    } catch (error) {
        console.error('[saveWorkspaceQuickNotes] Error:', error);
        return { success: false, error: 'Failed to save quick notes' };
    }
}

export async function saveWorkspacePins(pins: WorkspacePinnedItem[]): Promise<{ success: boolean; error?: string }> {
    const startedAt = performance.now();
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        await db.transaction(async (tx) => {
            const rows = await tx
                .select({ workspaceLayout: profiles.workspaceLayout })
                .from(profiles)
                .where(eq(profiles.id, user.id))
                .for('update')
                .limit(1);
            const current = rows[0]?.workspaceLayout ? parseWorkspaceLayout(rows[0].workspaceLayout) : DEFAULT_LAYOUT;

            const next: WorkspaceLayout = {
                ...current,
                pins: sanitizePins(pins),
            };

            await tx
                .update(profiles)
                .set({ workspaceLayout: next })
                .where(eq(profiles.id, user.id));
        });

        logWorkspaceMetric('workspace.pins.save_ms', startedAt, user.id);
        return { success: true };
    } catch (error) {
        console.error('[saveWorkspacePins] Error:', error);
        return { success: false, error: 'Failed to save pins' };
    }
}
