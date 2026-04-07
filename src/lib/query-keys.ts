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
      search: (query: string) => ["chat-v2", "search", query] as const,
      structuredCatalog: (conversationId: string | null | undefined, userId?: string | null) =>
        ["chat-v2", "structured-catalog", asNullable(conversationId), asNullable(userId)] as const,
      applications: (limit: number, offset: number) => ["chat-v2", "applications", limit, offset] as const,
      projectGroups: (limit: number, offset: number) => ["chat-v2", "project-groups", limit, offset] as const,
    },
  },
  profile: {
    root: () => ["profile"] as const,
    byTarget: (targetKey: string) => ["profile", targetKey] as const,
    projects: (userId: string) => ["profile", "projects", userId] as const,
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
      sprints: (projectId: string) => ["project", projectId, "detail", "sprints"] as const,
      analytics: (projectId: string) => ["project", projectId, "detail", "analytics"] as const,
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
  },
} as const;
