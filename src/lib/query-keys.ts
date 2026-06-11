import type { FilterView } from "@/constants/hub";
import type { HubFilters } from "@/types/hub";

const asCursor = (value?: string) => value ?? null;
const asNullable = (value?: string | null) => value ?? null;
type ProjectTaskScope = "all" | "backlog" | "sprint";

export const queryKeys = {
  hub: {
    root: () => ["hub"] as const,
    projectsRoot: () => ["hub", "projects"] as const,
    projectsSimpleRoot: () => ["hub", "projects-simple"] as const,
    projectsSimple: (view: FilterView, filters: HubFilters) => ["hub", "projects-simple", view, filters] as const,
    projects: (view: FilterView, filters: HubFilters) => ["hub", "projects", view, filters] as const,
    trending: () => ["hub", "trending"] as const,
    userFollowedProjects: (userId: string | null | undefined) =>
      ["hub", "user-followed-projects", asNullable(userId)] as const,
    userProjectIds: (userId: string | null) => ["hub", "user-project-ids", asNullable(userId)] as const,
    projectPrefetch: (projectId: string) => ["hub", "project-prefetch", projectId] as const,
  },
  connections: {
    root: () => ["connections"] as const,
  },
  messages: {
    conversations: () => ["chat", "conversations"] as const,
    targetUser: (userId: string) => ["chat", "targetUser", userId] as const,
    v2: {
      root: () => ["chat-v2"] as const,
      inbox: (limit: number) => ["chat-v2", "inbox", limit] as const,
      thread: (conversationId: string | null) => ["chat-v2", "thread", asNullable(conversationId)] as const,
      capabilities: (conversationId: string | null, userId?: string | null) =>
        ["chat-v2", "capabilities", asNullable(conversationId), asNullable(userId)] as const,
      unread: () => ["chat-v2", "unread"] as const,
      readCommitState: (conversationId: string | null | undefined) =>
        ["chat-v2", "read-commit-state", asNullable(conversationId)] as const,
      search: (query: string) => ["chat-v2", "search", query] as const,
      structuredCatalog: (conversationId: string | null | undefined, userId?: string | null) =>
        ["chat-v2", "structured-catalog", asNullable(conversationId), asNullable(userId)] as const,
      linkedWork: (conversationId: string | null | undefined, messageIds: readonly string[]) =>
        ["chat-v2", "linked-work", asNullable(conversationId), messageIds.slice().sort().join(",")] as const,
      applications: (limit: number, offset: number) => ["chat-v2", "applications", limit, offset] as const,
      projectGroups: (limit: number, offset: number) => ["chat-v2", "project-groups", limit, offset] as const,
    },
  },
  profile: {
    root: () => ["profile"] as const,
    byTarget: (targetKey: string) => ["profile", targetKey] as const,
    collaborationSummary: (userId: string) => ["profile", "collaboration-summary", userId] as const,
    projects: (userId: string) => ["profile", "projects", userId] as const,
    inviteOptions: (userId: string) => ["profile", "project-invite-options", userId] as const,
    stats: (userId: string) => ["profile", "stats", userId] as const,
  },
  project: {
    root: () => ["project"] as const,
    byId: (projectId: string) => ["project", projectId] as const,
    bySlug: (slug: string) => ["project", slug] as const,
    detail: {
      root: (projectId: string) => ["project", projectId, "detail"] as const,
      shell: (projectId: string) => ["project", projectId, "detail", "shell"] as const,
      tasksRoot: (projectId: string) => ["project", projectId, "detail", "tasks"] as const,
      tasks: (projectId: string, scope: ProjectTaskScope = "all") =>
        ["project", projectId, "detail", "tasks", scope] as const,
      sprintTasksRoot: (projectId: string) => ["project", projectId, "detail", "sprint-tasks"] as const,
      sprintTasks: (projectId: string, sprintId: string) =>
        ["project", projectId, "detail", "sprint-tasks", sprintId] as const,
      sprintDetailRoot: (projectId: string) => ["project", projectId, "detail", "sprint-detail"] as const,
      sprintDetail: (projectId: string, sprintId: string) =>
        ["project", projectId, "detail", "sprint-detail", sprintId] as const,
      sprintDetailShell: (projectId: string, sprintId: string | null) =>
        ["project", projectId, "detail", "sprint-detail", asNullable(sprintId), "shell"] as const,
      sprintDetailSummary: (projectId: string, sprintId: string | null) =>
        ["project", projectId, "detail", "sprint-detail", asNullable(sprintId), "summary"] as const,
      sprintTimeline: (projectId: string, sprintId: string | null) =>
        ["project", projectId, "detail", "sprint-detail", asNullable(sprintId), "timeline"] as const,
      sprints: (projectId: string) => ["project", projectId, "detail", "sprints"] as const,
      analytics: (projectId: string) => ["project", projectId, "detail", "analytics"] as const,
      analyticsOverview: (projectId: string, filters?: Record<string, unknown> | null) =>
        ["project", projectId, "detail", "analytics", "overview", filters ?? null] as const,
      analyticsMembers: (projectId: string, filters?: Record<string, unknown> | null) =>
        ["project", projectId, "detail", "analytics", "members", filters ?? null] as const,
      analyticsMember: (projectId: string, memberId: string | null | undefined) =>
        ["project", projectId, "detail", "analytics", "member", asNullable(memberId)] as const,
      analyticsWorkflow: (projectId: string, filters?: Record<string, unknown> | null) =>
        ["project", projectId, "detail", "analytics", "workflow", filters ?? null] as const,
      analyticsSprints: (projectId: string, filters?: Record<string, unknown> | null) =>
        ["project", projectId, "detail", "analytics", "sprints", filters ?? null] as const,
      analyticsFiles: (projectId: string, filters?: Record<string, unknown> | null) =>
        ["project", projectId, "detail", "analytics", "files", filters ?? null] as const,
      analyticsRisks: (projectId: string, filters?: Record<string, unknown> | null) =>
        ["project", projectId, "detail", "analytics", "risks", filters ?? null] as const,
      analyticsSnapshot: (projectId: string, filters?: Record<string, unknown> | null) =>
        ["project", projectId, "detail", "analytics", "snapshot", filters ?? null] as const,
      analyticsTimeline: (projectId: string, filters: Record<string, unknown> | null | undefined) =>
        ["project", projectId, "detail", "analytics", "timeline", filters ?? null] as const,
      readme: (projectId: string) => ["project", projectId, "detail", "readme"] as const,
      readmeDraft: (projectId: string) => ["project", projectId, "detail", "readme", "draft"] as const,
      readmeVersions: (projectId: string) => ["project", projectId, "detail", "readme", "versions"] as const,
      readmeSettings: (projectId: string) => ["project", projectId, "detail", "readme", "settings"] as const,
      readmeReferences: (projectId: string, kind: string, query: string) =>
        ["project", projectId, "detail", "readme", "references", kind, query] as const,
      readmeImportCandidates: (projectId: string, query: string) =>
        ["project", projectId, "detail", "readme", "import-candidates", query] as const,
      readmeSmartBlockPreviews: (projectId: string, blockSignature: string) =>
        ["project", projectId, "detail", "readme", "smart-block-previews", blockSignature] as const,
      updates: (projectId: string) => ["project", projectId, "detail", "updates"] as const,
      updateContextOptions: (projectId: string, kind: string, query: string) =>
        ["project", projectId, "detail", "updates", "context-options", kind, query] as const,
      updateDraft: (projectId: string, userId: string) =>
        ["project", projectId, "detail", "updates", "draft", userId] as const,
      updateComments: (projectId: string, updateId: string | null | undefined) =>
        ["project", projectId, "detail", "updates", asNullable(updateId), "comments"] as const,
      members: (projectId: string) => ["project", projectId, "detail", "members"] as const,
      filesNodes: (projectId: string, parentId?: string | null) =>
        ["project", projectId, "detail", "files-nodes", asNullable(parentId)] as const,
    },
  },
  settings: {
    root: () => ["settings"] as const,
    notifications: () => ["settings", "notifications"] as const,
    security: () => ["settings", "security"] as const,
    privacy: () => ["settings", "privacy"] as const,
    integrations: () => ["settings", "integrations"] as const,
    mfaFactors: () => ["settings", "security", "mfa-factors"] as const,
    loginHistory: () => ["settings", "security", "login-history"] as const,
  },
  notifications: {
    root: () => ["notifications"] as const,
    page: (limit: number) => ["notifications", "page", limit] as const,
    unreadCount: () => ["notifications", "unread-count"] as const,
  },
} as const;
