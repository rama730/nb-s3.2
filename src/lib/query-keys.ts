import type { WorkspaceTaskFilters } from "@/app/actions/workspace";
import type { FilterView } from "@/constants/hub";
import type { HubFilters } from "@/types/hub";

const asCursor = (value?: string) => value ?? null;
const asNullable = (value?: string | null) => value ?? null;
type ProjectTaskScope = "all" | "backlog" | "sprint";

export const queryKeys = {
  workspace: {
    root: () => ["workspace"] as const,
    overview: () => ["workspace", "overview"] as const,
    overviewBase: () => ["workspace", "overview-base"] as const,
    overviewSectionRoot: () => ["workspace", "overview-section"] as const,
    overviewSection: {
      tasks: () => ["workspace", "overview-section", "tasks"] as const,
      projects: () => ["workspace", "overview-section", "projects"] as const,
      conversations: () => ["workspace", "overview-section", "conversations"] as const,
      recentActivity: () => ["workspace", "overview-section", "recent-activity"] as const,
      files: () => ["workspace", "overview-section", "files"] as const,
      mentionsRequests: () => ["workspace", "overview-section", "mentions-requests"] as const,
    },
    tasksRoot: () => ["workspace", "tasks"] as const,
    tasksList: (filters: WorkspaceTaskFilters, cursor?: string) =>
      ["workspace", "tasks", filters, asCursor(cursor)] as const,
    inboxRoot: () => ["workspace", "inbox"] as const,
    inboxList: (cursor?: string) => ["workspace", "inbox", asCursor(cursor)] as const,
    activity: () => ["workspace", "activity"] as const,
    preferences: () => ["workspace", "preferences"] as const,
    panelMembers: (projectId: string | null) => ["workspace", "panel-members", asNullable(projectId)] as const,
    panelSprints: (projectId: string | null) => ["workspace", "panel-sprints", asNullable(projectId)] as const,
  },
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
  messages: {
    conversations: () => ["chat", "conversations"] as const,
    targetUser: (userId: string) => ["chat", "targetUser", userId] as const,
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
  },
} as const;
