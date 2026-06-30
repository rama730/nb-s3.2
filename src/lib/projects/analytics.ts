export type ProjectAnalyticsAccessLevel = "public" | "viewer" | "member" | "co_leader" | "owner";

export type ProjectAnalyticsTabId =
    | "overview"
    | "members"
    | "workflow"
    | "sprints"
    | "files"
    | "risks"
    | "timeline";

export type ProjectAnalyticsContextDateRange = "all" | "7d" | "30d" | "90d";

export type ProjectAnalyticsContextFilters = {
    memberId: string | null;
    source: "all" | ProjectAnalyticsTimelineEvent["sourceSurface"];
    dateRange: ProjectAnalyticsContextDateRange;
};

export type ProjectAnalyticsActionLink = {
    label: string;
    href: string;
    tab?: ProjectAnalyticsTabId | "dashboard" | "readme" | "tasks" | "settings";
    entityId?: string | null;
};

export type ProjectAnalyticsFileSource = "github" | "manual" | "system";

export type ProjectAnalyticsInsight = {
    id: string;
    title: string;
    body: string;
    tone: "neutral" | "success" | "warning" | "danger";
    metric?: string | number;
    actionLink: ProjectAnalyticsActionLink;
};

export type ProjectAnalyticsPerson = {
    id: string;
    name: string;
    username: string | null;
    avatarUrl: string | null;
    role: ProjectAnalyticsMemberInput["role"];
    roleLabel: "Owner" | "Co-leader" | "Member" | "Viewer" | "Former collaborator";
    subtext: string;
    state: "active" | "former";
};

export type ProjectAnalyticsOverview = {
    accessLevel: ProjectAnalyticsAccessLevel;
    commandCenter: ProjectAnalyticsInsight[];
    nextMoves: ProjectAnalyticsInsight[];
    pulse: {
        activeWork: number;
        completedWork: number;
        blockedWork: number;
        staleWork: number;
        pendingReviews: number;
        recentMovement: number;
        workloadBalance: "balanced" | "watch" | "heavy";
    };
    comparison: ProjectAnalyticsComparisonSummary;
    needsAttention: ProjectAnalyticsInsight[];
    recentMovement: ProjectAnalyticsTimelineEvent[];
    sourceSummary: {
        tasks: number;
        members: number;
        sprints: number;
        files: number;
        githubFiles?: number;
        manualFiles?: number;
        privateFilesHidden?: number;
        events?: number;
        caps?: Partial<Record<"tasks" | "sprints" | "files" | "fileVersions" | "taskFileLinks" | "comments" | "applications" | "roles" | "workflows" | "events", number>>;
        capped?: Partial<Record<"tasks" | "sprints" | "files" | "fileVersions" | "taskFileLinks" | "comments" | "applications" | "roles" | "workflows" | "events", boolean>>;
    };
};

export type ProjectAnalyticsMemberSummary = {
    person: ProjectAnalyticsPerson;
    activeTasks: number;
    completedTasks: number;
    blockedTasks: number;
    staleTasks: number;
    fileContributions: number;
    reviewResponsibilities: number;
    supportSignals: ProjectAnalyticsInsight[];
    actionLink: ProjectAnalyticsActionLink;
};

export type ProjectAnalyticsMemberDetail = {
    person: ProjectAnalyticsPerson;
    currentResponsibilities: ProjectAnalyticsTaskRef[];
    pendingWork: ProjectAnalyticsTaskRef[];
    blockedWork: ProjectAnalyticsTaskRef[];
    completedWork: ProjectAnalyticsTaskRef[];
    sprintParticipation: Array<{ sprintId: string; sprintName: string; active: number; completed: number }>;
    fileContribution: Array<{
        fileId: string;
        fileName: string;
        versions: number;
        latestChangedAt: string;
        source: ProjectAnalyticsFileSource;
        actionLink: ProjectAnalyticsActionLink;
    }>;
    fileContributionTotal: number;
    collaborationActivity: ProjectAnalyticsTimelineEvent[];
};

export type ProjectAnalyticsWorkflow = {
    statusCounts: Record<string, number>;
    friction: ProjectAnalyticsInsight[];
    unassigned: ProjectAnalyticsTaskRef[];
    blocked: ProjectAnalyticsTaskRef[];
    stale: ProjectAnalyticsTaskRef[];
    removedMemberAssignments: ProjectAnalyticsTaskRef[];
};

export type ProjectAnalyticsSprintSummary = {
    id: string;
    name: string;
    status: string;
    startDate: string | null;
    endDate: string | null;
    planned: number;
    active: number;
    completed: number;
    blocked: number;
    carriedForward: number;
    story: string;
    actionLink: ProjectAnalyticsActionLink;
};

export type ProjectAnalyticsFiles = {
    active: ProjectAnalyticsFileRef[];
    needsReview: ProjectAnalyticsFileRef[];
    recentlyChanged: ProjectAnalyticsFileRef[];
    linkedToWork: ProjectAnalyticsFileRef[];
    possiblyStale: ProjectAnalyticsFileRef[];
    memberContributions: Array<{ person: ProjectAnalyticsPerson; files: number; versions: number }>;
    activityBatches: ProjectAnalyticsFileActivityBatch[];
};

export type ProjectAnalyticsFileActivityBatch = {
    id: string;
    label: string;
    count: number;
    versions: number;
    occurredAt: string;
    contributor: ProjectAnalyticsPerson | null;
    actionLink: ProjectAnalyticsActionLink;
};

export type ProjectAnalyticsRiskSignal = {
    id: string;
    severity: "low" | "medium" | "high";
    lifecycleStatus: ProjectAnalyticsRiskLifecycleStatus;
    title: string;
    signal?: string;
    reason: string;
    affectedItem: string;
    affectedSurface?: string;
    owner?: ProjectAnalyticsPerson | null;
    suggestedAction: string;
    actionLink: ProjectAnalyticsActionLink;
};

export type ProjectAnalyticsRiskLifecycleStatus = "active" | "acknowledged" | "resolved" | "dismissed";

export type ProjectAnalyticsComparisonSummary = {
    label: string;
    currentWindow: string;
    previousWindow: string;
    currentMovement: number;
    previousMovement: number;
    movementDelta: number;
    currentCompleted: number;
    previousCompleted: number;
    completedDelta: number;
};

export type ProjectAnalyticsSnapshot = {
    overview: ProjectAnalyticsOverview;
    members: ProjectAnalyticsMemberSummary[];
    workflow: ProjectAnalyticsWorkflow;
    sprints: ProjectAnalyticsSprintSummary[];
    files: ProjectAnalyticsFiles;
    risks: ProjectAnalyticsRiskSignal[];
    timeline: { items: ProjectAnalyticsTimelineEvent[]; nextCursor: string | null; total: number };
    context: ProjectAnalyticsContextFilters;
    generatedAt: string;
};

export type ProjectAnalyticsTimelineEvent = {
    id: string;
    type: "task" | "sprint" | "file" | "member" | "application" | "workflow" | "settings";
    sourceSurface: "tasks" | "sprints" | "files" | "members" | "applications" | "workflow" | "settings";
    title: string;
    description: string;
    occurredAt: string;
    actor?: ProjectAnalyticsPerson | null;
    actionLink: ProjectAnalyticsActionLink;
    groupedCount?: number;
    hiddenCount?: number;
    sourceKind?: ProjectAnalyticsFileSource;
    representativeNames?: string[];
};

export type ProjectAnalyticsTaskRef = {
    id: string;
    title: string;
    status: string;
    priority: string | null;
    assigneeId: string | null;
    assigneeName: string;
    ageDays: number;
    updatedAt: string;
    actionLink: ProjectAnalyticsActionLink;
};

export type ProjectAnalyticsFileRef = {
    id: string;
    name: string;
    type: string;
    updatedAt: string;
    contributorId: string | null;
    source: ProjectAnalyticsFileSource;
    publicVisible: boolean;
    actionLink: ProjectAnalyticsActionLink;
};

export type ProjectAnalyticsMemberInput = {
    id: string;
    userId: string;
    role: "owner" | "admin" | "member" | "viewer" | string;
    joinedAt?: string | Date | null;
    user?: {
        id: string;
        username?: string | null;
        fullName?: string | null;
        avatarUrl?: string | null;
    } | null;
};

export type ProjectAnalyticsProfileInput = {
    id: string;
    username?: string | null;
    fullName?: string | null;
    avatarUrl?: string | null;
};

export type ProjectAnalyticsTaskInput = {
    id: string;
    title: string;
    status: string;
    priority?: string | null;
    assigneeId?: string | null;
    creatorId?: string | null;
    sprintId?: string | null;
    dueDate?: string | Date | null;
    createdAt?: string | Date | null;
    updatedAt?: string | Date | null;
};

export type ProjectAnalyticsSprintInput = {
    id: string;
    name: string;
    status?: string | null;
    startDate?: string | Date | null;
    endDate?: string | Date | null;
    createdAt?: string | Date | null;
    updatedAt?: string | Date | null;
};

export type ProjectAnalyticsFileInput = {
    id: string;
    name: string;
    type?: string | null;
    path?: string | null;
    createdBy?: string | null;
    createdAt?: string | Date | null;
    updatedAt?: string | Date | null;
    source?: ProjectAnalyticsFileSource | null;
    analyticsVisible?: boolean | null;
    publicVisible?: boolean | null;
    privateReason?: string | null;
};

export type ProjectAnalyticsFileVersionInput = {
    id: string;
    nodeId: string;
    uploadedBy?: string | null;
    uploadedAt?: string | Date | null;
};

export type ProjectAnalyticsTaskFileLinkInput = {
    id: string;
    taskId: string;
    nodeId: string;
    annotation?: string | null;
    linkedAt?: string | Date | null;
};

export type ProjectAnalyticsCommentInput = {
    id: string;
    taskId: string;
    userId?: string | null;
    createdAt?: string | Date | null;
};

export type ProjectAnalyticsApplicationInput = {
    id: string;
    applicantId: string;
    status: string;
    createdAt?: string | Date | null;
    updatedAt?: string | Date | null;
};

export type ProjectAnalyticsRoleInput = {
    id: string;
    title?: string | null;
    role?: string | null;
    count?: number | null;
    filled?: number | null;
    updatedAt?: string | Date | null;
};

export type ProjectAnalyticsWorkflowInput = {
    id: string;
    targetId?: string | null;
    status?: string | null;
    assigneeUserId?: string | null;
    createdBy?: string | null;
    createdAt?: string | Date | null;
    updatedAt?: string | Date | null;
};

export type ProjectAnalyticsRawEventInput = {
    id: string;
    type: string;
    actorId?: string | null;
    metadata?: Record<string, unknown> | null;
    createdAt?: string | Date | null;
};

export type BuildProjectAnalyticsInput = {
    project: {
        id: string;
        slug?: string | null;
        title?: string | null;
        ownerId?: string | null;
        importSourceType?: "github" | "upload" | "scratch" | null;
        syncStatus?: string | null;
    };
    accessLevel: ProjectAnalyticsAccessLevel;
    actorId?: string | null;
    now?: string | Date;
    hiddenPrivateFiles?: number;
    members: ProjectAnalyticsMemberInput[];
    profiles?: ProjectAnalyticsProfileInput[];
    tasks: ProjectAnalyticsTaskInput[];
    sprints: ProjectAnalyticsSprintInput[];
    files: ProjectAnalyticsFileInput[];
    fileVersions: ProjectAnalyticsFileVersionInput[];
    taskFileLinks: ProjectAnalyticsTaskFileLinkInput[];
    comments: ProjectAnalyticsCommentInput[];
    applications: ProjectAnalyticsApplicationInput[];
    roles: ProjectAnalyticsRoleInput[];
    workflows: ProjectAnalyticsWorkflowInput[];
    events: ProjectAnalyticsRawEventInput[];
};

export type ProjectAnalyticsTimelineFilters = {
    memberId?: string | null;
    type?: ProjectAnalyticsTimelineEvent["type"] | "all" | null;
    source?: string | null;
    dateFrom?: string | null;
    dateTo?: string | null;
    limit?: number | null;
    cursor?: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_DAYS = 7;
const BLOCKED_ATTENTION_DAYS = 3;

export const PROJECT_ANALYTICS_DATASET_LIMITS = {
    members: 200,
    tasks: 500,
    sprints: 100,
    files: 300,
    fileVersions: 500,
    taskFileLinks: 500,
    comments: 300,
    applications: 200,
    roles: 100,
    workflows: 300,
    events: 200,
} as const;

const ANALYTICS_SOURCES = new Set<ProjectAnalyticsContextFilters["source"]>([
    "all",
    "tasks",
    "sprints",
    "files",
    "members",
    "applications",
    "workflow",
    "settings",
]);

const asDate = (value: string | Date | null | undefined, fallback = new Date(0)) => {
    if (!value) return fallback;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date;
};

const iso = (value: string | Date | null | undefined) => asDate(value, new Date()).toISOString();

const daysOld = (value: string | Date | null | undefined, now: Date) => {
    const date = asDate(value, now);
    return Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY_MS));
};

export function normalizeProjectAnalyticsContext(context?: Partial<ProjectAnalyticsContextFilters> | null): ProjectAnalyticsContextFilters {
    const source = context?.source && ANALYTICS_SOURCES.has(context.source) ? context.source : "all";
    const dateRange = context?.dateRange === "all" || context?.dateRange === "7d" || context?.dateRange === "90d"
        ? context.dateRange
        : "30d";
    const memberId = typeof context?.memberId === "string" && context.memberId.trim().length > 0 ? context.memberId : null;
    return { memberId, source, dateRange };
}

const contextWindowStart = (context: ProjectAnalyticsContextFilters, now: Date) => {
    if (context.dateRange === "all") return null;
    const days = context.dateRange === "7d" ? 7 : context.dateRange === "90d" ? 90 : 30;
    return new Date(now.getTime() - days * DAY_MS);
};

const withinContextWindow = (
    value: string | Date | null | undefined,
    context: ProjectAnalyticsContextFilters,
    now: Date,
) => {
    const start = contextWindowStart(context, now);
    if (!start) return true;
    return asDate(value, now) >= start;
};

const memberMatches = (context: ProjectAnalyticsContextFilters, ...ids: Array<string | null | undefined>) =>
    !context.memberId || ids.includes(context.memberId);

const surfaceAllows = (context: ProjectAnalyticsContextFilters, surface: ProjectAnalyticsTimelineEvent["sourceSurface"]) => {
    if (context.source === "all") return true;
    if (context.source === "members") return true;
    if (context.source === "workflow") return surface === "workflow" || surface === "tasks";
    return context.source === surface;
};

export function filterProjectAnalyticsDatasetByContext(
    input: BuildProjectAnalyticsInput,
    contextInput?: Partial<ProjectAnalyticsContextFilters> | null,
): BuildProjectAnalyticsInput {
    const context = normalizeProjectAnalyticsContext(contextInput);
    const visibleFiles = analyticsVisibleFiles(input);
    const visibleFileIds = new Set(visibleFiles.map((file) => file.id));
    const sourceInput = visibleFiles.length === input.files.length
        ? input
        : {
            ...input,
            files: visibleFiles,
            fileVersions: input.fileVersions.filter((version) => visibleFileIds.has(version.nodeId)),
            taskFileLinks: input.taskFileLinks.filter((link) => visibleFileIds.has(link.nodeId)),
        };
    if (context.source === "all" && context.memberId === null && context.dateRange === "all") return sourceInput;

    const now = asDate(sourceInput.now, new Date());
    const versionsByNode = versionsByNodeLatestFirst(sourceInput.fileVersions);
    const fileIdsForMember = new Set(
        context.memberId
            ? sourceInput.fileVersions
                .filter((version) => version.uploadedBy === context.memberId)
                .map((version) => version.nodeId)
            : [],
    );
    const tasks = surfaceAllows(context, "tasks")
        ? sourceInput.tasks.filter((task) =>
            memberMatches(context, task.assigneeId, task.creatorId) &&
            withinContextWindow(task.updatedAt ?? task.createdAt, context, now))
        : [];
    const taskIds = new Set(tasks.map((task) => task.id));
    const sprints = surfaceAllows(context, "sprints")
        ? sourceInput.sprints.filter((sprint) => withinContextWindow(sprint.updatedAt ?? sprint.endDate ?? sprint.startDate ?? sprint.createdAt, context, now))
        : [];
    const files = surfaceAllows(context, "files")
        ? sourceInput.files.filter((file) => {
            const contributorId = fileActivityContributorId(file, versionsByNode);
            return memberMatches(context, contributorId, file.createdBy, fileIdsForMember.has(file.id) ? context.memberId : null) &&
                withinContextWindow(fileActivityAt(file, versionsByNode), context, now);
        })
        : [];
    const fileIds = new Set(files.map((file) => file.id));
    return {
        ...sourceInput,
        members: context.memberId ? sourceInput.members.filter((member) => member.userId === context.memberId) : sourceInput.members,
        tasks,
        sprints,
        files,
        fileVersions: surfaceAllows(context, "files")
            ? sourceInput.fileVersions.filter((version) =>
                fileIds.has(version.nodeId) &&
                memberMatches(context, version.uploadedBy) &&
                withinContextWindow(version.uploadedAt, context, now))
            : [],
        taskFileLinks: (surfaceAllows(context, "tasks") || surfaceAllows(context, "files"))
            ? sourceInput.taskFileLinks.filter((link) =>
                (taskIds.has(link.taskId) || fileIds.has(link.nodeId)) &&
                withinContextWindow(link.linkedAt, context, now))
            : [],
        comments: surfaceAllows(context, "tasks")
            ? sourceInput.comments.filter((comment) =>
                taskIds.has(comment.taskId) &&
                memberMatches(context, comment.userId) &&
                withinContextWindow(comment.createdAt, context, now))
            : [],
        applications: surfaceAllows(context, "applications")
            ? sourceInput.applications.filter((application) =>
                memberMatches(context, application.applicantId) &&
                withinContextWindow(application.updatedAt ?? application.createdAt, context, now))
            : [],
        roles: surfaceAllows(context, "applications")
            ? sourceInput.roles.filter((role) => withinContextWindow(role.updatedAt, context, now))
            : [],
        workflows: surfaceAllows(context, "workflow")
            ? sourceInput.workflows.filter((workflow) =>
                memberMatches(context, workflow.assigneeUserId, workflow.createdBy) &&
                withinContextWindow(workflow.updatedAt ?? workflow.createdAt, context, now))
            : [],
        events: surfaceAllows(context, "settings") || surfaceAllows(context, "members") || surfaceAllows(context, "files")
            ? sourceInput.events.filter((event) =>
                memberMatches(context, event.actorId) &&
                withinContextWindow(event.createdAt, context, now))
            : [],
    };
}

const isDone = (task: ProjectAnalyticsTaskInput) => task.status === "done" || task.status === "completed";
const isActive = (task: ProjectAnalyticsTaskInput) => !isDone(task);
const isBlocked = (task: ProjectAnalyticsTaskInput) => task.status === "blocked";

const routeBase = (input: BuildProjectAnalyticsInput) => `/projects/${input.project.slug || input.project.id}`;

const actionLink = (
    input: BuildProjectAnalyticsInput,
    label: string,
    tab: ProjectAnalyticsTabId | "dashboard" | "readme" | "tasks" | "settings",
    entityId?: string | null,
): ProjectAnalyticsActionLink => {
    const surfaceTab = tab === "workflow" ? "tasks" : tab === "overview" || tab === "members" || tab === "risks" || tab === "timeline" ? "analytics" : tab;
    const params = new URLSearchParams({ tab: surfaceTab });
    if (surfaceTab === "analytics") params.set("analyticsTab", tab);
    if (entityId) {
        if (tab === "workflow") params.set("taskId", entityId);
        else if (tab === "files") params.set("nodeId", entityId);
        else if (tab === "sprints") params.set("sprintId", entityId);
        else if (tab === "members") params.set("memberId", entityId);
        else params.set("focus", entityId);
    }
    return { label, tab, entityId: entityId ?? null, href: `${routeBase(input)}?${params.toString()}` };
};

const roleLabel = (role: ProjectAnalyticsMemberInput["role"], isOwner = false): ProjectAnalyticsPerson["roleLabel"] => {
    if (isOwner || role === "owner") return "Owner";
    if (role === "admin") return "Co-leader";
    if (role === "viewer") return "Viewer";
    if (role === "former") return "Former collaborator";
    return "Member";
};

const activeMemberUserIds = (input: BuildProjectAnalyticsInput) => new Set(input.members.map((member) => member.userId));

const ANALYTICS_FILE_CAP = 4;

const normalizeFileSource = (file: Pick<ProjectAnalyticsFileInput, "source" | "path">, input: BuildProjectAnalyticsInput): ProjectAnalyticsFileSource => {
    if (file.source === "github" || file.source === "manual" || file.source === "system") return file.source;
    if (input.project.importSourceType === "github") return "github";
    if (input.project.importSourceType === "upload") return "manual";
    return "manual";
};

const analyticsVisibleFiles = (input: BuildProjectAnalyticsInput) =>
    input.files.filter((file) => file.analyticsVisible !== false);

const privateFilesHidden = (input: BuildProjectAnalyticsInput) =>
    input.hiddenPrivateFiles ?? input.files.filter((file) => file.analyticsVisible === false).length;

const fileDisplayName = (file: ProjectAnalyticsFileInput) => file.path && file.path !== "/" ? file.path : file.name;

const fileLatestAt = (
    file: ProjectAnalyticsFileInput,
    versions: ProjectAnalyticsFileVersionInput[] = [],
) => {
    const latestVersion = versions
        .map((version) => iso(version.uploadedAt))
        .sort()
        .at(-1);
    return latestVersion ?? iso(file.updatedAt ?? file.createdAt);
};

const versionsByNodeLatestFirst = (versions: ProjectAnalyticsFileVersionInput[]) => {
    const grouped = new Map<string, ProjectAnalyticsFileVersionInput[]>();
    for (const version of versions) {
        const existing = grouped.get(version.nodeId);
        if (existing) existing.push(version);
        else grouped.set(version.nodeId, [version]);
    }
    for (const nodeVersions of grouped.values()) {
        nodeVersions.sort((a, b) => {
            const byTime = asDate(b.uploadedAt).getTime() - asDate(a.uploadedAt).getTime();
            return byTime || b.id.localeCompare(a.id);
        });
    }
    return grouped;
};

const latestFileVersion = (
    fileId: string,
    versionsByNode: Map<string, ProjectAnalyticsFileVersionInput[]>,
) => versionsByNode.get(fileId)?.[0] ?? null;

const fileActivityAt = (
    file: ProjectAnalyticsFileInput,
    versionsByNode: Map<string, ProjectAnalyticsFileVersionInput[]>,
) => latestFileVersion(file.id, versionsByNode)?.uploadedAt ?? file.updatedAt ?? file.createdAt;

const fileActivityContributorId = (
    file: ProjectAnalyticsFileInput,
    versionsByNode: Map<string, ProjectAnalyticsFileVersionInput[]>,
) => latestFileVersion(file.id, versionsByNode)?.uploadedBy ?? file.createdBy ?? null;

const profileMap = (input: BuildProjectAnalyticsInput) => {
    const map = new Map<string, ProjectAnalyticsProfileInput>();
    for (const member of input.members) {
        if (member.user) map.set(member.user.id, member.user);
    }
    for (const profile of input.profiles ?? []) map.set(profile.id, profile);
    return map;
};

export function formatProjectAnalyticsPerson(
    profile: ProjectAnalyticsProfileInput | null | undefined,
    membership?: ProjectAnalyticsMemberInput | null,
    projectOwnerId?: string | null,
): ProjectAnalyticsPerson {
    const id = profile?.id ?? membership?.userId ?? "unknown";
    const name = profile?.fullName || profile?.username || (id === "unknown" ? "Unknown user" : "Former collaborator");
    const isOwner = projectOwnerId === id || membership?.role === "owner";
    const active = Boolean(membership);
    return {
        id,
        name,
        username: profile?.username ?? null,
        avatarUrl: profile?.avatarUrl ?? null,
        role: membership?.role ?? "former",
        roleLabel: active ? roleLabel(membership?.role ?? "member", isOwner) : "Former collaborator",
        subtext: active ? roleLabel(membership?.role ?? "member", isOwner) : "Removed from project",
        state: active ? "active" : "former",
    };
}

export function resolveProjectAnalyticsAccess(input: {
    actorId?: string | null;
    projectOwnerId?: string | null;
    members?: Array<Pick<ProjectAnalyticsMemberInput, "userId" | "role">>;
    projectIsPublic?: boolean;
}): ProjectAnalyticsAccessLevel {
    const actorId = input.actorId ?? null;
    if (!actorId) return input.projectIsPublic ? "public" : "public";
    if (input.projectOwnerId === actorId) return "owner";
    const membership = input.members?.find((member) => member.userId === actorId);
    if (!membership) return "public";
    if (membership.role === "admin") return "co_leader";
    if (membership.role === "viewer") return "viewer";
    return "member";
}

const toTaskRef = (
    task: ProjectAnalyticsTaskInput,
    input: BuildProjectAnalyticsInput,
    now: Date,
): ProjectAnalyticsTaskRef => {
    const profiles = profileMap(input);
    const member = input.members.find((entry) => entry.userId === task.assigneeId);
    const person = formatProjectAnalyticsPerson(
        task.assigneeId ? profiles.get(task.assigneeId) : null,
        member ?? null,
        input.project.ownerId,
    );
    return {
        id: task.id,
        title: task.title || "Untitled task",
        status: task.status,
        priority: task.priority ?? null,
        assigneeId: task.assigneeId ?? null,
        assigneeName: task.assigneeId ? person.name : "Unassigned",
        ageDays: daysOld(task.updatedAt ?? task.createdAt, now),
        updatedAt: iso(task.updatedAt ?? task.createdAt),
        actionLink: actionLink(input, "Open task", "workflow", task.id),
    };
};

const pendingReviewLinks = (input: BuildProjectAnalyticsInput) =>
    input.taskFileLinks.filter((link) => /\breview\b/i.test(link.annotation ?? ""));

const staleTasks = (input: BuildProjectAnalyticsInput, now: Date) =>
    input.tasks.filter((task) => isActive(task) && daysOld(task.updatedAt ?? task.createdAt, now) >= STALE_DAYS);

const recentTaskMovement = (input: BuildProjectAnalyticsInput, now: Date) =>
    input.tasks.filter((task) => daysOld(task.updatedAt ?? task.createdAt, now) <= 7);

const buildProjectNextMoves = (
    input: BuildProjectAnalyticsInput,
    activeTasks: ProjectAnalyticsTaskInput[],
    completedTasks: ProjectAnalyticsTaskInput[],
): ProjectAnalyticsInsight[] => {
    const visibleFiles = analyticsVisibleFiles(input);
    const nextMoves: ProjectAnalyticsInsight[] = [];
    const importSource = input.project.importSourceType ?? "scratch";
    const hasReadmeImport = input.events.some((event) => /readme/i.test(event.type) || /readme/i.test(String(event.metadata?.sourceFileName ?? "")));
    if (importSource === "github") {
        if (!hasReadmeImport) {
            nextMoves.push({
                id: "next-review-readme",
                title: "Review the imported Doc",
                body: "Confirm the GitHub Doc tells the project story before sending collaborators into the workspace.",
                tone: "neutral",
                actionLink: actionLink(input, "Open Doc", "readme"),
            });
        }
        if (activeTasks.length === 0) {
            nextMoves.push({
                id: "next-create-first-task",
                title: "Create the first project task",
                body: "Turn the repository into a small work queue so the next contributor has a clear place to start.",
                tone: "neutral",
                actionLink: actionLink(input, "Open Tasks", "workflow"),
            });
        }
        nextMoves.push({
            id: "next-file-privacy",
            title: "Confirm file visibility",
            body: `${visibleFiles.length} indexed ${visibleFiles.length === 1 ? "file is" : "files are"} available to analytics. Hide private files from Settings when they are not project signals.`,
            tone: privateFilesHidden(input) > 0 ? "success" : "neutral",
            metric: privateFilesHidden(input) > 0 ? `${privateFilesHidden(input)} hidden` : visibleFiles.length,
            actionLink: actionLink(input, "Open file settings", "settings"),
        });
    } else if (importSource === "upload") {
        nextMoves.push({
            id: "next-organize-upload",
            title: "Review uploaded files",
            body: "Keep manual files in Settings, choose visibility, then link the few that matter to active work.",
            tone: "neutral",
            metric: visibleFiles.length,
            actionLink: actionLink(input, "Open file settings", "settings"),
        });
    } else {
        if (visibleFiles.length === 0) {
            nextMoves.push({
                id: "next-add-readme",
                title: "Add the project starting point",
                body: "Create a Doc or first task so Analytics can move from empty-state guidance to real project signals.",
                tone: "neutral",
                actionLink: actionLink(input, "Open project dashboard", "dashboard"),
            });
        }
    }
    if (input.sprints.length === 0 && activeTasks.length > 0) {
        nextMoves.push({
            id: "next-first-sprint",
            title: "Group active work into a sprint",
            body: "A lightweight sprint gives the team a clearer timeline without adding more file noise.",
            tone: "neutral",
            actionLink: actionLink(input, "Open Sprints", "sprints"),
        });
    }
    if (input.members.length <= 1 && activeTasks.length + completedTasks.length > 0) {
        nextMoves.push({
            id: "next-invite-member",
            title: "Invite a collaborator",
            body: "The project has work signals, but only one active member. Add a collaborator when responsibility needs to spread.",
            tone: "neutral",
            actionLink: actionLink(input, "Open members", "members"),
        });
    }
    return nextMoves.slice(0, ANALYTICS_FILE_CAP);
};

export function buildProjectAnalyticsComparison(
    input: BuildProjectAnalyticsInput,
    contextInput?: Partial<ProjectAnalyticsContextFilters> | null,
): ProjectAnalyticsComparisonSummary {
    const context = normalizeProjectAnalyticsContext(contextInput);
    const now = asDate(input.now, new Date());
    const days = context.dateRange === "7d" ? 7 : context.dateRange === "90d" ? 90 : 30;
    const windowMs = days * DAY_MS;
    const currentStart = new Date(now.getTime() - windowMs);
    const previousStart = new Date(now.getTime() - windowMs * 2);
    const inCurrent = (value: string | Date | null | undefined) => {
        const date = asDate(value, now);
        return date >= currentStart && date <= now;
    };
    const inPrevious = (value: string | Date | null | undefined) => {
        const date = asDate(value, now);
        return date >= previousStart && date < currentStart;
    };
    const currentMovement = input.tasks.filter((task) => inCurrent(task.updatedAt ?? task.createdAt)).length;
    const previousMovement = input.tasks.filter((task) => inPrevious(task.updatedAt ?? task.createdAt)).length;
    const currentCompleted = input.tasks.filter((task) => isDone(task) && inCurrent(task.updatedAt ?? task.createdAt)).length;
    const previousCompleted = input.tasks.filter((task) => isDone(task) && inPrevious(task.updatedAt ?? task.createdAt)).length;
    const label = context.dateRange === "all" ? "Recent 30 days vs prior 30 days" : `Last ${days} days vs prior ${days} days`;
    return {
        label,
        currentWindow: context.dateRange === "all" ? "Recent 30 days" : `Last ${days} days`,
        previousWindow: `Prior ${days} days`,
        currentMovement,
        previousMovement,
        movementDelta: currentMovement - previousMovement,
        currentCompleted,
        previousCompleted,
        completedDelta: currentCompleted - previousCompleted,
    };
}

export function buildProjectAnalyticsOverview(
    input: BuildProjectAnalyticsInput,
    comparisonContext?: Partial<ProjectAnalyticsContextFilters> | null,
    comparisonInput: BuildProjectAnalyticsInput = input,
): ProjectAnalyticsOverview {
    const now = asDate(input.now, new Date());
    const visibleFiles = analyticsVisibleFiles(input);
    const activeTasks = input.tasks.filter(isActive);
    const completedTasks = input.tasks.filter(isDone);
    const blockedTasks = input.tasks.filter(isBlocked);
    const stale = staleTasks(input, now);
    const reviews = pendingReviewLinks(input);
    const movement = recentTaskMovement(input, now);
    const memberWork = new Map<string, number>();
    for (const task of activeTasks) {
        if (task.assigneeId) memberWork.set(task.assigneeId, (memberWork.get(task.assigneeId) ?? 0) + 1);
    }
    const maxLoad = Math.max(0, ...memberWork.values());
    const insights: ProjectAnalyticsInsight[] = [];
    if (stale.length > 0) {
        insights.push({
            id: "stale-work",
            title: `${stale.length} stale ${stale.length === 1 ? "task" : "tasks"}`,
            body: "These active tasks have not moved recently and may need a small unblock.",
            tone: "warning",
            metric: stale.length,
            actionLink: actionLink(input, "Review stale work", "workflow", stale[0]?.id),
        });
    }
    if (reviews.length > 0) {
        insights.push({
            id: "pending-file-review",
            title: `${reviews.length} file ${reviews.length === 1 ? "review is" : "reviews are"} waiting`,
            body: "Linked files are carrying review annotations that need a project member's attention.",
            tone: "warning",
            metric: reviews.length,
            actionLink: actionLink(input, "Open file review queue", "files", reviews[0]?.nodeId),
        });
    }
    if (blockedTasks.length > 0) {
        insights.push({
            id: "blocked-work",
            title: `${blockedTasks.length} blocked ${blockedTasks.length === 1 ? "task" : "tasks"}`,
            body: "Blocked work is visible so the team can help without turning analytics into a blame board.",
            tone: "danger",
            metric: blockedTasks.length,
            actionLink: actionLink(input, "Open blocked work", "risks", blockedTasks[0]?.id),
        });
    }
    if (insights.length === 0) {
        insights.push({
            id: "steady-project",
            title: "Project looks steady",
            body: "No stale, blocked, or review-heavy work is visible in the current project signals.",
            tone: "success",
            actionLink: actionLink(input, "Review recent moments", "timeline"),
        });
    }
    const commandCenter = insights.slice(0, 3);
    if (maxLoad >= 6) {
        commandCenter.push({
            id: "workload-balance",
            title: "Workload is concentrated",
            body: "One member is carrying six or more active tasks. Review the member map before adding more work.",
            tone: "warning",
            metric: maxLoad,
            actionLink: actionLink(input, "Open member workload", "members"),
        });
    }
    if (commandCenter.length > 3) commandCenter.length = 3;

    return {
        accessLevel: input.accessLevel,
        commandCenter,
        nextMoves: buildProjectNextMoves(input, activeTasks, completedTasks),
        pulse: {
            activeWork: activeTasks.length,
            completedWork: completedTasks.length,
            blockedWork: blockedTasks.length,
            staleWork: stale.length,
            pendingReviews: reviews.length,
            recentMovement: movement.length,
            workloadBalance: maxLoad >= 6 ? "heavy" : maxLoad >= 4 ? "watch" : "balanced",
        },
        comparison: buildProjectAnalyticsComparison(comparisonInput, comparisonContext),
        needsAttention: insights,
        recentMovement: buildProjectAnalyticsTimeline(input, { limit: ANALYTICS_FILE_CAP }).items,
        sourceSummary: {
            tasks: input.tasks.length,
            members: input.members.length,
            sprints: input.sprints.length,
            files: visibleFiles.length,
            githubFiles: visibleFiles.filter((file) => normalizeFileSource(file, input) === "github").length,
            manualFiles: visibleFiles.filter((file) => normalizeFileSource(file, input) === "manual").length,
            privateFilesHidden: privateFilesHidden(input),
            events: input.events.length,
            caps: PROJECT_ANALYTICS_DATASET_LIMITS,
            capped: {
                tasks: input.tasks.length >= PROJECT_ANALYTICS_DATASET_LIMITS.tasks,
                sprints: input.sprints.length >= PROJECT_ANALYTICS_DATASET_LIMITS.sprints,
                files: visibleFiles.length >= PROJECT_ANALYTICS_DATASET_LIMITS.files,
                fileVersions: input.fileVersions.length >= PROJECT_ANALYTICS_DATASET_LIMITS.fileVersions,
                taskFileLinks: input.taskFileLinks.length >= PROJECT_ANALYTICS_DATASET_LIMITS.taskFileLinks,
                comments: input.comments.length >= PROJECT_ANALYTICS_DATASET_LIMITS.comments,
                applications: input.applications.length >= PROJECT_ANALYTICS_DATASET_LIMITS.applications,
                roles: input.roles.length >= PROJECT_ANALYTICS_DATASET_LIMITS.roles,
                workflows: input.workflows.length >= PROJECT_ANALYTICS_DATASET_LIMITS.workflows,
                events: input.events.length >= PROJECT_ANALYTICS_DATASET_LIMITS.events,
            },
        },
    };
}

export function buildProjectAnalyticsMemberSummaries(input: BuildProjectAnalyticsInput): ProjectAnalyticsMemberSummary[] {
    const now = asDate(input.now, new Date());
    const profiles = profileMap(input);
    const visibleFileIds = new Set(analyticsVisibleFiles(input).map((file) => file.id));
    return input.members
        .map((member) => {
            const person = formatProjectAnalyticsPerson(profiles.get(member.userId), member, input.project.ownerId);
            const assigned = input.tasks.filter((task) => task.assigneeId === member.userId);
            const active = assigned.filter(isActive);
            const completed = assigned.filter(isDone);
            const blocked = assigned.filter(isBlocked);
            const stale = active.filter((task) => daysOld(task.updatedAt ?? task.createdAt, now) >= STALE_DAYS);
            const versions = input.fileVersions.filter((version) => version.uploadedBy === member.userId && visibleFileIds.has(version.nodeId));
            const reviews = input.taskFileLinks.filter((link) => /\breview\b/i.test(link.annotation ?? ""));
            const supportSignals: ProjectAnalyticsInsight[] = [];
            if (blocked.length > 0) {
                supportSignals.push({
                    id: `${member.userId}-blocked`,
                    title: `${blocked.length} blocked`,
                    body: "This member may need support on blocked work.",
                    tone: "warning",
                    metric: blocked.length,
                    actionLink: actionLink(input, "Review member work", "members", member.userId),
                });
            }
            if (stale.length > 0) {
                supportSignals.push({
                    id: `${member.userId}-stale`,
                    title: `${stale.length} stale`,
                    body: "Some assigned work has not moved recently.",
                    tone: "warning",
                    metric: stale.length,
                    actionLink: actionLink(input, "Open member detail", "members", member.userId),
                });
            }
            return {
                person,
                activeTasks: active.length,
                completedTasks: completed.length,
                blockedTasks: blocked.length,
                staleTasks: stale.length,
                fileContributions: versions.length,
                reviewResponsibilities: reviews.length,
                supportSignals,
                actionLink: actionLink(input, "Open member intelligence", "members", member.userId),
            };
        })
        .sort((a, b) => {
            const roleOrder = { Owner: 0, "Co-leader": 1, Member: 2, Viewer: 3, "Former collaborator": 4 };
            return roleOrder[a.person.roleLabel] - roleOrder[b.person.roleLabel] || a.person.name.localeCompare(b.person.name);
        });
}

export function buildProjectAnalyticsMemberDetail(
    input: BuildProjectAnalyticsInput,
    memberUserId: string,
): ProjectAnalyticsMemberDetail {
    const now = asDate(input.now, new Date());
    const profiles = profileMap(input);
    const membership = input.members.find((member) => member.userId === memberUserId) ?? null;
    const person = formatProjectAnalyticsPerson(profiles.get(memberUserId), membership, input.project.ownerId);
    const assigned = input.tasks.filter((task) => task.assigneeId === memberUserId);
    const created = input.tasks.filter((task) => task.creatorId === memberUserId && task.assigneeId !== memberUserId);
    const currentResponsibilities = assigned.filter(isActive).map((task) => toTaskRef(task, input, now));
    const pendingWork = [...assigned, ...created]
        .filter((task) => isActive(task) && !isBlocked(task))
        .map((task) => toTaskRef(task, input, now));
    const blockedWork = assigned.filter(isBlocked).map((task) => toTaskRef(task, input, now));
    const completedWork = assigned.filter(isDone).map((task) => toTaskRef(task, input, now));
    const sprintParticipation = input.sprints
        .map((sprint) => {
            const sprintTasks = assigned.filter((task) => task.sprintId === sprint.id);
            return {
                sprintId: sprint.id,
                sprintName: sprint.name,
                active: sprintTasks.filter(isActive).length,
                completed: sprintTasks.filter(isDone).length,
            };
        })
        .filter((entry) => entry.active + entry.completed > 0);
    const allFileContribution = analyticsVisibleFiles(input)
        .map((file) => {
            const versions = input.fileVersions.filter((version) => version.nodeId === file.id && version.uploadedBy === memberUserId);
            const latestChangedAt = fileLatestAt(file, versions);
            return {
                fileId: file.id,
                fileName: fileDisplayName(file),
                versions: versions.length,
                latestChangedAt,
                source: normalizeFileSource(file, input),
                actionLink: actionLink(input, "Open file", "files", file.id),
            };
        })
        .filter((entry) => entry.versions > 0)
        .sort((a, b) => asDate(b.latestChangedAt).getTime() - asDate(a.latestChangedAt).getTime());

    return {
        person,
        currentResponsibilities,
        pendingWork,
        blockedWork,
        completedWork,
        sprintParticipation,
        fileContribution: allFileContribution.slice(0, ANALYTICS_FILE_CAP),
        fileContributionTotal: allFileContribution.length,
        collaborationActivity: buildProjectAnalyticsTimeline(input, { memberId: memberUserId, limit: 12 }).items,
    };
}

export function buildProjectAnalyticsWorkflow(input: BuildProjectAnalyticsInput): ProjectAnalyticsWorkflow {
    const now = asDate(input.now, new Date());
    const activeMembers = activeMemberUserIds(input);
    const statusCounts = input.tasks.reduce<Record<string, number>>((acc, task) => {
        acc[task.status] = (acc[task.status] ?? 0) + 1;
        return acc;
    }, {});
    const unassigned = input.tasks.filter((task) => isActive(task) && !task.assigneeId).map((task) => toTaskRef(task, input, now));
    const blocked = input.tasks.filter(isBlocked).map((task) => toTaskRef(task, input, now));
    const stale = staleTasks(input, now).map((task) => toTaskRef(task, input, now));
    const removedMemberAssignments = input.tasks
        .filter((task) => isActive(task) && task.assigneeId && !activeMembers.has(task.assigneeId))
        .map((task) => toTaskRef(task, input, now));
    const friction: ProjectAnalyticsInsight[] = [];
    if (unassigned.length) {
        friction.push({
            id: "unassigned-work",
            title: `${unassigned.length} unassigned active ${unassigned.length === 1 ? "task" : "tasks"}`,
            body: "Active work is easier to finish when there is a clear owner.",
            tone: "warning",
            metric: unassigned.length,
            actionLink: actionLink(input, "Review unassigned work", "workflow", unassigned[0]?.id),
        });
    }
    if (blocked.length) {
        friction.push({
            id: "blocked-too-long",
            title: `${blocked.length} blocked ${blocked.length === 1 ? "task" : "tasks"}`,
            body: "Blocked tasks should be treated as a team support signal.",
            tone: "danger",
            metric: blocked.length,
            actionLink: actionLink(input, "Open blocked work", "workflow", blocked[0]?.id),
        });
    }
    if (removedMemberAssignments.length) {
        friction.push({
            id: "former-assignee",
            title: `${removedMemberAssignments.length} task ${removedMemberAssignments.length === 1 ? "needs" : "need"} reassignment`,
            body: "Some active work still points to a former collaborator.",
            tone: "danger",
            metric: removedMemberAssignments.length,
            actionLink: actionLink(input, "Reassign work", "workflow", removedMemberAssignments[0]?.id),
        });
    }
    return { statusCounts, friction, unassigned, blocked, stale, removedMemberAssignments };
}

export function buildProjectAnalyticsSprints(input: BuildProjectAnalyticsInput): ProjectAnalyticsSprintSummary[] {
    return input.sprints
        .map((sprint) => {
            const sprintTasks = input.tasks.filter((task) => task.sprintId === sprint.id);
            const active = sprintTasks.filter(isActive).length;
            const completed = sprintTasks.filter(isDone).length;
            const blocked = sprintTasks.filter(isBlocked).length;
            const story = sprintTasks.length === 0
                ? "No tasks are attached to this sprint yet."
                : `Started with ${sprintTasks.length} ${sprintTasks.length === 1 ? "task" : "tasks"}, completed ${completed}, and ${blocked} ${blocked === 1 ? "is" : "are"} blocked.`;
            return {
                id: sprint.id,
                name: sprint.name,
                status: sprint.status ?? "planning",
                startDate: sprint.startDate ? iso(sprint.startDate) : null,
                endDate: sprint.endDate ? iso(sprint.endDate) : null,
                planned: sprintTasks.length,
                active,
                completed,
                blocked,
                carriedForward: sprintTasks.filter((task) => isActive(task) && task.updatedAt && sprint.endDate && asDate(task.updatedAt) > asDate(sprint.endDate)).length,
                story,
                actionLink: actionLink(input, "Open sprint", "sprints", sprint.id),
            };
        })
        .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));
}

export function buildProjectAnalyticsFiles(input: BuildProjectAnalyticsInput): ProjectAnalyticsFiles {
    const now = asDate(input.now, new Date());
    const profiles = profileMap(input);
    const memberByUserId = new Map(input.members.map((member) => [member.userId, member]));
    const visibleFiles = analyticsVisibleFiles(input);
    const visibleFileIds = new Set(visibleFiles.map((file) => file.id));
    const versionsByNode = versionsByNodeLatestFirst(input.fileVersions);
    const toFileRef = (file: ProjectAnalyticsFileInput): ProjectAnalyticsFileRef => ({
        id: file.id,
        name: fileDisplayName(file),
        type: file.type ?? "file",
        updatedAt: iso(fileActivityAt(file, versionsByNode)),
        contributorId: fileActivityContributorId(file, versionsByNode),
        source: normalizeFileSource(file, input),
        publicVisible: file.publicVisible !== false,
        actionLink: actionLink(input, "Open file", "files", file.id),
    });
    const linkedNodeIds = new Set(input.taskFileLinks.map((link) => link.nodeId));
    const reviewNodeIds = new Set(pendingReviewLinks(input).map((link) => link.nodeId));
    const active = visibleFiles.map(toFileRef);
    const memberContributions = buildProjectAnalyticsMemberSummaries(input)
        .map((summary) => ({
            person: summary.person,
            files: visibleFiles.filter((file) => fileActivityContributorId(file, versionsByNode) === summary.person.id).length,
            versions: input.fileVersions.filter((version) => version.uploadedBy === summary.person.id && visibleFileIds.has(version.nodeId)).length,
        }))
        .filter((entry) => entry.files + entry.versions > 0);
    const batchMap = new Map<string, {
        contributorId: string | null;
        day: string;
        source: ProjectAnalyticsFileSource;
        count: number;
        versions: number;
        fileId: string | null;
        latest: string;
    }>();
    for (const file of visibleFiles) {
        const updated = iso(fileActivityAt(file, versionsByNode));
        const day = updated.slice(0, 10);
        const contributorId = fileActivityContributorId(file, versionsByNode);
        const source = normalizeFileSource(file, input);
        const key = `${day}:${source}:${contributorId ?? "unknown"}`;
        const current = batchMap.get(key) ?? {
            contributorId,
            day,
            source,
            count: 0,
            versions: 0,
            fileId: file.id,
            latest: updated,
        };
        current.count += 1;
        current.versions += versionsByNode.get(file.id)?.length ?? 0;
        if (asDate(updated) > asDate(current.latest)) {
            current.latest = updated;
            current.fileId = file.id;
        }
        batchMap.set(key, current);
    }
    const activityBatches = [...batchMap.values()]
        .sort((a, b) => asDate(b.latest).getTime() - asDate(a.latest).getTime())
        .map((batch) => ({
            id: `${batch.day}:${batch.source}:${batch.contributorId ?? "unknown"}`,
            label: batch.source === "github"
                ? `${batch.count} repository ${batch.count === 1 ? "file" : "files"} indexed`
                : `${batch.count} ${batch.count === 1 ? "file" : "files"} changed`,
            count: batch.count,
            versions: batch.versions,
            occurredAt: batch.latest,
            contributor: batch.contributorId
                ? formatProjectAnalyticsPerson(profiles.get(batch.contributorId), memberByUserId.get(batch.contributorId) ?? null, input.project.ownerId)
                : null,
            actionLink: actionLink(input, "Open file workspace", "files", batch.fileId),
        }));
    return {
        active,
        needsReview: visibleFiles.filter((file) => reviewNodeIds.has(file.id)).map(toFileRef),
        recentlyChanged: visibleFiles
            .filter((file) => daysOld(fileActivityAt(file, versionsByNode), now) <= 7)
            .map(toFileRef),
        linkedToWork: visibleFiles.filter((file) => linkedNodeIds.has(file.id)).map(toFileRef),
        possiblyStale: visibleFiles
            .filter((file) => daysOld(fileActivityAt(file, versionsByNode), now) >= 30 && !linkedNodeIds.has(file.id))
            .map(toFileRef),
        memberContributions,
        activityBatches,
    };
}

export function buildProjectAnalyticsRisks(input: BuildProjectAnalyticsInput): ProjectAnalyticsRiskSignal[] {
    const now = asDate(input.now, new Date());
    const workflow = buildProjectAnalyticsWorkflow(input);
    const risks: ProjectAnalyticsRiskSignal[] = [];
    const lifecycleByRiskId = new Map<string, ProjectAnalyticsRiskLifecycleStatus>();
    for (const event of [...input.events].sort((a, b) => asDate(a.createdAt).getTime() - asDate(b.createdAt).getTime())) {
        if (event.type !== "project_analytics.risk_lifecycle_changed") continue;
        const riskId = typeof event.metadata?.riskId === "string" ? event.metadata.riskId : null;
        const status = event.metadata?.status;
        if (!riskId) continue;
        if (status === "active" || status === "acknowledged" || status === "resolved" || status === "dismissed") {
            lifecycleByRiskId.set(riskId, status);
        }
    }
    const ownerForTask = (task?: ProjectAnalyticsTaskRef | null) => {
        if (!task?.assigneeId) return null;
        const profiles = profileMap(input);
        const member = input.members.find((entry) => entry.userId === task.assigneeId);
        return formatProjectAnalyticsPerson(profiles.get(task.assigneeId), member ?? null, input.project.ownerId);
    };
    const addRisk = (
        id: string,
        severity: ProjectAnalyticsRiskSignal["severity"],
        title: string,
        signal: string,
        reason: string,
        affectedItem: string,
        affectedSurface: string,
        suggestedAction: string,
        action: ProjectAnalyticsActionLink,
        owner?: ProjectAnalyticsPerson | null,
    ) => risks.push({
        id,
        severity,
        lifecycleStatus: lifecycleByRiskId.get(id) ?? "active",
        title,
        signal,
        reason,
        affectedItem,
        affectedSurface,
        suggestedAction,
        actionLink: action,
        owner,
    });
    if (workflow.blocked.length) {
        addRisk("blocked-tasks", "high", "Blocked work needs support", `${workflow.blocked.length} blocked`, "Blocked tasks can stall dependent work.", `${workflow.blocked.length} blocked tasks`, "Tasks", "Open the blocked tasks and decide the next unblock step.", actionLink(input, "Review blocked work", "workflow", workflow.blocked[0]?.id), ownerForTask(workflow.blocked[0]));
    }
    if (workflow.stale.length) {
        addRisk("stale-tasks", "medium", "Stale work has gone quiet", `${STALE_DAYS}+ days quiet`, `No recent movement for at least ${STALE_DAYS} days.`, `${workflow.stale.length} stale tasks`, "Tasks", "Confirm whether each task is still needed or needs a smaller next step.", actionLink(input, "Review stale work", "workflow", workflow.stale[0]?.id), ownerForTask(workflow.stale[0]));
    }
    if (workflow.unassigned.length) {
        addRisk("unassigned-work", "medium", "Active work is unassigned", `${workflow.unassigned.length} unowned`, "Unowned active work is easy to miss.", `${workflow.unassigned.length} unassigned tasks`, "Tasks", "Assign an eligible member or move the work back to backlog.", actionLink(input, "Assign work", "workflow", workflow.unassigned[0]?.id));
    }
    if (workflow.removedMemberAssignments.length) {
        addRisk("removed-member-assignment", "high", "Former collaborator still owns active work", "Former assignee", "Removed members should not remain responsible for active project work.", `${workflow.removedMemberAssignments.length} tasks need reassignment`, "Collaborators", "Reassign active tasks to an active member.", actionLink(input, "Reassign former-member work", "workflow", workflow.removedMemberAssignments[0]?.id), ownerForTask(workflow.removedMemberAssignments[0]));
    }
    const overloaded = buildProjectAnalyticsMemberSummaries(input).filter((member) => member.activeTasks >= 6);
    if (overloaded.length) {
        addRisk("overloaded-members", "medium", "Workload may be concentrated", "6+ active tasks", "One or more members are carrying six or more active tasks.", `${overloaded.length} members`, "Members", "Review member detail and redistribute work where helpful.", actionLink(input, "Open member workload", "members", overloaded[0]?.person.id), overloaded[0]?.person ?? null);
    }
    const reviews = pendingReviewLinks(input);
    if (reviews.length) {
        addRisk("pending-file-reviews", "medium", "File review queue is waiting", `${reviews.length} reviews`, "Review annotations are present on linked files.", `${reviews.length} file reviews`, "Files", "Open the files intelligence view and resolve review items.", actionLink(input, "Open file reviews", "files", reviews[0]?.nodeId));
    }
    const pendingApplications = input.applications.filter((application) => application.status === "pending");
    if (pendingApplications.length) {
        addRisk("pending-applications", "medium", "Applications are waiting", `${pendingApplications.length} pending`, "Pending applications may block role capacity or collaborator onboarding.", `${pendingApplications.length} pending applications`, "Roles & applications", "Review applications and route decisions.", actionLink(input, "Open roles", "overview", pendingApplications[0]?.id));
    }
    const activeSprintWithDrift = input.sprints.find((sprint) => sprint.status === "active" && sprint.endDate && asDate(sprint.endDate) < now);
    if (activeSprintWithDrift) {
        addRisk("sprint-drift", "medium", "Active sprint is past its end date", "Past end date", "Sprint cadence may need a closeout or carry-forward decision.", activeSprintWithDrift.name, "Sprints", "Review the sprint story and close or update the sprint.", actionLink(input, "Open sprint", "sprints", activeSprintWithDrift.id));
    }
    if (recentTaskMovement(input, now).length === 0 && input.tasks.length > 0) {
        addRisk("low-recent-movement", "low", "Project movement is quiet", "No task movement", "No task movement was detected in the last week.", "Project timeline", "Timeline", "Check whether the project is paused or needs a planning update.", actionLink(input, "Open timeline", "timeline"));
    }
    const openRolesNoProgress = input.roles.filter((role) => (role.count ?? 0) > (role.filled ?? 0));
    if (openRolesNoProgress.length && pendingApplications.length === 0) {
        addRisk("open-roles-no-progress", "low", "Open roles have no applicant movement", "Open capacity", "Open capacity exists but no pending application activity is visible.", `${openRolesNoProgress.length} open roles`, "Roles & applications", "Review role copy or share the project with suitable collaborators.", actionLink(input, "Review roles", "overview", openRolesNoProgress[0]?.id));
    }
    return risks;
}

export function buildProjectAnalyticsTimeline(
    input: BuildProjectAnalyticsInput,
    filters: ProjectAnalyticsTimelineFilters = {},
): { items: ProjectAnalyticsTimelineEvent[]; nextCursor: string | null; total: number } {
    const profiles = profileMap(input);
    const memberByUserId = new Map(input.members.map((member) => [member.userId, member]));
    const person = (userId?: string | null) =>
        userId ? formatProjectAnalyticsPerson(profiles.get(userId), memberByUserId.get(userId) ?? null, input.project.ownerId) : null;
    const events: ProjectAnalyticsTimelineEvent[] = [];
    for (const task of input.tasks) {
        events.push({
            id: `task:${task.id}:updated`,
            type: "task",
            sourceSurface: "tasks",
            title: task.title || "Task updated",
            description: isDone(task) ? "Task is completed." : `Task is currently ${task.status}.`,
            occurredAt: iso(task.updatedAt ?? task.createdAt),
            actor: person(task.assigneeId ?? task.creatorId),
            actionLink: actionLink(input, "Open task", "workflow", task.id),
        });
    }
    for (const sprint of input.sprints) {
        events.push({
            id: `sprint:${sprint.id}`,
            type: "sprint",
            sourceSurface: "sprints",
            title: sprint.name,
            description: `Sprint is ${sprint.status ?? "planning"}.`,
            occurredAt: iso(sprint.updatedAt ?? sprint.createdAt ?? sprint.startDate),
            actor: null,
            actionLink: actionLink(input, "Open sprint", "sprints", sprint.id),
        });
    }
    const versionsByNode = versionsByNodeLatestFirst(input.fileVersions);
    const fileGroups = new Map<string, {
        files: ProjectAnalyticsFileInput[];
        contributorId: string | null;
        day: string;
        source: ProjectAnalyticsFileSource;
    }>();
    for (const file of analyticsVisibleFiles(input)) {
        const occurredAt = iso(fileActivityAt(file, versionsByNode));
        const day = occurredAt.slice(0, 10);
        const source = normalizeFileSource(file, input);
        const contributorId = fileActivityContributorId(file, versionsByNode);
        const key = `${day}:${source}:${contributorId ?? "unknown"}`;
        const group = fileGroups.get(key) ?? { files: [], contributorId, day, source };
        group.files.push(file);
        fileGroups.set(key, group);
    }
    for (const group of fileGroups.values()) {
        const sortedFiles = group.files
            .slice()
            .sort((a, b) => asDate(fileActivityAt(b, versionsByNode)).getTime() - asDate(fileActivityAt(a, versionsByNode)).getTime());
        const first = sortedFiles[0];
        if (!first) continue;
        const firstOccurredAt = iso(fileActivityAt(first, versionsByNode));
        if (sortedFiles.length > ANALYTICS_FILE_CAP || group.source === "github") {
            const representativeNames = sortedFiles.slice(0, ANALYTICS_FILE_CAP).map(fileDisplayName);
            events.push({
                id: `file-group:${group.source}:${group.contributorId ?? "unknown"}:${group.day}`,
                type: "file",
                sourceSurface: "files",
                title: group.source === "github" ? "Repository files indexed" : `${sortedFiles.length} file changes`,
                description: group.source === "github"
                    ? `${sortedFiles.length} GitHub ${sortedFiles.length === 1 ? "file was" : "files were"} indexed as project context. Open Files for the full inventory.`
                    : `${sortedFiles.length} workspace files changed in this period. Showing the newest ${Math.min(ANALYTICS_FILE_CAP, sortedFiles.length)} as examples.`,
                occurredAt: firstOccurredAt,
                actor: person(group.contributorId),
                actionLink: actionLink(input, "Open file workspace", "files", first.id),
                groupedCount: sortedFiles.length,
                hiddenCount: Math.max(0, sortedFiles.length - ANALYTICS_FILE_CAP),
                sourceKind: group.source,
                representativeNames,
            });
            continue;
        }
        for (const file of sortedFiles) {
            const source = normalizeFileSource(file, input);
            events.push({
                id: `file:${file.id}`,
                type: "file",
                sourceSurface: "files",
                title: fileDisplayName(file),
                description: source === "manual" ? "Manual file changed in the workspace." : "File changed in the workspace.",
                occurredAt: iso(fileActivityAt(file, versionsByNode)),
                actor: person(fileActivityContributorId(file, versionsByNode)),
                actionLink: actionLink(input, "Open file", "files", file.id),
                sourceKind: source,
            });
        }
    }
    for (const application of input.applications) {
        events.push({
            id: `application:${application.id}`,
            type: "application",
            sourceSurface: "applications",
            title: `Application ${application.status}`,
            description: "Role/application movement was recorded.",
            occurredAt: iso(application.updatedAt ?? application.createdAt),
            actor: person(application.applicantId),
            actionLink: actionLink(input, "Review application", "overview", application.id),
        });
    }
    for (const workflow of input.workflows) {
        events.push({
            id: `workflow:${workflow.id}`,
            type: "workflow",
            sourceSurface: "workflow",
            title: `Workflow ${workflow.status ?? "updated"}`,
            description: "Linked workflow activity changed.",
            occurredAt: iso(workflow.updatedAt ?? workflow.createdAt),
            actor: person(workflow.assigneeUserId ?? workflow.createdBy),
            actionLink: actionLink(input, "Open workflow", "workflow", workflow.targetId ?? workflow.id),
        });
    }
    for (const event of input.events) {
        const eventType = event.type.includes("member")
            ? "member"
            : event.type.includes("setting")
                ? "settings"
                : event.type.includes("file")
                    ? "file"
                    : "settings";
        events.push({
            id: `event:${event.id}`,
            type: eventType,
            sourceSurface: eventType === "member" ? "members" : eventType === "file" ? "files" : "settings",
            title: event.type.replaceAll("_", " ").replaceAll(".", " "),
            description: "Project activity was recorded.",
            occurredAt: iso(event.createdAt),
            actor: person(event.actorId),
            actionLink: actionLink(input, "Open project surface", "timeline", event.id),
        });
    }

    const from = filters.dateFrom ? asDate(filters.dateFrom) : null;
    const to = filters.dateTo ? asDate(filters.dateTo) : null;
    const filtered = events
        .filter((event) => {
            if (filters.memberId && event.actor?.id !== filters.memberId) return false;
            if (filters.type && filters.type !== "all" && event.type !== filters.type) return false;
            if (filters.source && filters.source !== "all" && event.sourceSurface !== filters.source) return false;
            const occurred = asDate(event.occurredAt);
            if (from && occurred < from) return false;
            if (to && occurred > to) return false;
            if (filters.cursor && occurred >= asDate(filters.cursor)) return false;
            return true;
        })
        .sort((a, b) => asDate(b.occurredAt).getTime() - asDate(a.occurredAt).getTime());
    const limit = Math.min(Math.max(filters.limit ?? 40, 1), 100);
    return {
        items: filtered.slice(0, limit),
        nextCursor: filtered.length > limit ? filtered[limit - 1]?.occurredAt ?? null : null,
        total: filtered.length,
    };
}

export function buildProjectAnalyticsSnapshot(
    input: BuildProjectAnalyticsInput,
    contextInput?: Partial<ProjectAnalyticsContextFilters> | null,
): ProjectAnalyticsSnapshot {
    const context = normalizeProjectAnalyticsContext(contextInput);
    const scoped = filterProjectAnalyticsDatasetByContext(input, context);
    const timelineFilters: ProjectAnalyticsTimelineFilters = {
        memberId: context.memberId,
        source: context.source,
        limit: 40,
    };
    return {
        overview: buildProjectAnalyticsOverview(scoped, context, input),
        members: scoped.accessLevel === "public" ? [] : buildProjectAnalyticsMemberSummaries(scoped),
        workflow: scoped.accessLevel === "public"
            ? { statusCounts: {}, friction: [], unassigned: [], blocked: [], stale: [], removedMemberAssignments: [] }
            : buildProjectAnalyticsWorkflow(scoped),
        sprints: scoped.accessLevel === "public" ? [] : buildProjectAnalyticsSprints(scoped),
        files: buildProjectAnalyticsFiles(scoped.accessLevel === "public" ? { ...scoped, taskFileLinks: [] } : scoped),
        risks: scoped.accessLevel === "owner" || scoped.accessLevel === "co_leader" ? buildProjectAnalyticsRisks(scoped) : [],
        timeline: buildProjectAnalyticsTimeline(
            scoped.accessLevel === "public" ? { ...scoped, events: [], comments: [], workflows: [] } : scoped,
            timelineFilters,
        ),
        context,
        generatedAt: iso(input.now ?? new Date()),
    };
}

export function buildProjectAnalyticsReport(snapshot: ProjectAnalyticsSnapshot): string {
    const overview = snapshot.overview;
    const comparison = overview.comparison;
    const riskLines = snapshot.risks.slice(0, 8).map((risk) => `- [${risk.severity}] ${risk.title}: ${risk.suggestedAction}`);
    const memberLines = snapshot.members.slice(0, 8).map((member) =>
        `- ${member.person.name} (${member.person.roleLabel}): ${member.activeTasks} active, ${member.completedTasks} completed, ${member.fileContributions} file contributions`);
    const fileLines = snapshot.files.activityBatches.slice(0, 8).map((batch) =>
        `- ${batch.label} by ${batch.contributor?.name ?? "Unknown contributor"} on ${batch.occurredAt.slice(0, 10)}`);
    return [
        "# Project Analytics Report",
        "",
        `Generated: ${snapshot.generatedAt}`,
        `Context: member=${snapshot.context.memberId ?? "all"}, surface=${snapshot.context.source}, window=${snapshot.context.dateRange}`,
        "",
        "## Pulse",
        `- Active work: ${overview.pulse.activeWork}`,
        `- Completed work: ${overview.pulse.completedWork}`,
        `- Blocked work: ${overview.pulse.blockedWork}`,
        `- Stale work: ${overview.pulse.staleWork}`,
        `- Pending reviews: ${overview.pulse.pendingReviews}`,
        "",
        "## Compare",
        `- ${comparison.label}`,
        `- Movement: ${comparison.currentMovement} (${comparison.movementDelta >= 0 ? "+" : ""}${comparison.movementDelta})`,
        `- Completed: ${comparison.currentCompleted} (${comparison.completedDelta >= 0 ? "+" : ""}${comparison.completedDelta})`,
        "",
        "## Members",
        ...(memberLines.length ? memberLines : ["- No member contribution rows matched this context."]),
        "",
        "## Risks",
        ...(riskLines.length ? riskLines : ["- No operational risk signals matched this context."]),
        "",
        "## File Movement",
        ...(fileLines.length ? fileLines : ["- No file movement batches matched this context."]),
        "",
    ].join("\n");
}
