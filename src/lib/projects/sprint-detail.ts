import { z } from "zod";

export const SPRINT_TIMELINE_FILTERS = [
  "all",
  "work",
  "blocked",
  "completed",
  "files",
] as const;

export type SprintTimelineFilter = (typeof SPRINT_TIMELINE_FILTERS)[number];

export const SPRINT_TIMELINE_MODES = [
  "chronological",
  "grouped",
  "files",
] as const;

export type SprintTimelineMode = (typeof SPRINT_TIMELINE_MODES)[number];
export const SPRINT_TIMELINE_MODE_LABELS: Record<SprintTimelineMode, string> = {
  chronological: "Chronological",
  grouped: "Grouped by task",
  files: "Files",
};

export const SPRINT_DRAWER_TYPES = ["task", "file"] as const;
export type SprintDrawerType = (typeof SPRINT_DRAWER_TYPES)[number];

export type SprintStatus = "planning" | "active" | "completed";
export type SprintMemberRole = "owner" | "admin" | "member" | "viewer" | null;
export type SprintTaskStatus = "todo" | "in_progress" | "done" | "blocked";
export type SprintTaskPriority = "low" | "medium" | "high" | "urgent";
export type SprintFileNodeType = "file" | "folder";

export type SprintTimelinePerson = {
  id: string;
  fullName: string | null;
  avatarUrl: string | null;
} | null;

export type SprintListItem = {
  id: string;
  projectId: string;
  name: string;
  goal: string | null;
  startDate: string | null;
  endDate: string | null;
  status: SprintStatus;
  createdAt: string | null;
  updatedAt: string | null;
};

export type SprintPermissionSet = {
  canRead: boolean;
  canWrite: boolean;
  canCreate: boolean;
  canStart: boolean;
  canComplete: boolean;
  isOwner: boolean;
  isMember: boolean;
  memberRole: SprintMemberRole;
};

export type SprintHealthSummary = {
  totalTasks: number;
  completedTasks: number;
  blockedTasks: number;
  linkedFileCount: number;
  totalStoryPoints: number;
  completedStoryPoints: number;
  completionPercentage: number;
};

export type SprintFilterCounts = Record<SprintTimelineFilter, number>;
export type SprintVisibleCounts = Partial<Record<SprintTimelineFilter, number>>;

export type SprintTaskTimelineEntity = {
  id: string;
  projectId: string;
  sprintId: string;
  taskNumber: number | null;
  title: string;
  description: string | null;
  status: SprintTaskStatus;
  priority: SprintTaskPriority;
  storyPoints: number | null;
  dueDate: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  activityAt: string | null;
  linkedFileCount: number;
  assignee: SprintTimelinePerson;
  creator: SprintTimelinePerson;
};

export type SprintFileTimelineEntity = {
  id: string;
  taskId: string;
  nodeId: string;
  nodeName: string;
  nodePath: string;
  nodeType: SprintFileNodeType;
  annotation: string | null;
  linkedAt: string | null;
  lastEventType: string | null;
  lastEventAt: string | null;
  lastEventBy: string | null;
};

export type SprintTimelineRow =
  | {
      id: string;
      kind: "kickoff";
      occurredAt: string | null;
      sprint: SprintListItem;
    }
  | {
      id: string;
      kind: "task";
      occurredAt: string | null;
      task: SprintTaskTimelineEntity;
    }
  | {
      id: string;
      kind: "file";
      occurredAt: string | null;
      task: Pick<SprintTaskTimelineEntity, "id" | "title" | "taskNumber" | "status" | "priority">;
      file: SprintFileTimelineEntity;
    }
  | {
      id: string;
      kind: "closeout";
      occurredAt: string | null;
      sprint: SprintListItem;
      summary: SprintHealthSummary;
    };

export type SprintDetailPayload = {
  projectId: string;
  projectSlug: string | null;
  sprints: SprintListItem[];
  selectedSprintId: string | null;
  permissions: SprintPermissionSet;
  timelineMode: SprintTimelineMode;
  summary: SprintHealthSummary | null;
  compareSummary: SprintCompareSummary | null;
  filterCounts: SprintFilterCounts;
  rows: SprintTimelineRow[];
  drawerPreviews: SprintDrawerPreview[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type SprintDrawerState =
  | {
      type: "none";
      id: null;
    }
  | {
      type: SprintDrawerType;
      id: string;
    };

export type SprintDrawerPreview =
  | {
      type: "task";
      id: string;
      title: string;
      subtitle: string;
      occurredAt: string | null;
      badgeText: string;
    }
  | {
      type: "file";
      id: string;
      title: string;
      subtitle: string;
      occurredAt: string | null;
      badgeText: string;
    };

export type SprintCompareMetric = {
  current: number;
  previous: number | null;
  delta: number | null;
  direction: "up" | "down" | "flat" | "none";
  isPositive: boolean | null;
};

export type SprintCompareSummary = {
  baselineKind: "previous_sprint" | "first_sprint";
  baselineSprintId: string | null;
  baselineSprintName: string | null;
  completionRate: SprintCompareMetric;
  blockedTasks: SprintCompareMetric;
  linkedFiles: SprintCompareMetric;
  completedStoryPoints: SprintCompareMetric;
};

export type SprintViewPreference = {
  mode: SprintTimelineMode;
  filter: SprintTimelineFilter;
};

export type SprintRouteState = {
  filter: SprintTimelineFilter;
  mode: SprintTimelineMode;
  drawer: SprintDrawerState;
  hasExplicitFilter: boolean;
  hasExplicitMode: boolean;
};

type SearchParamsReader = {
  get(name: string): string | null;
};

function isSearchParamsReader(
  input: URLSearchParams | SearchParamsReader | Record<string, string | string[] | undefined>,
): input is SearchParamsReader {
  return "get" in input && typeof input.get === "function";
}

export const SPRINT_STATUS_PRESENTATION: Record<
  SprintStatus,
  {
    label: string;
    dotClassName: string;
    toneClassName: string;
  }
> = {
  planning: {
    label: "Planning",
    dotClassName: "bg-indigo-500/70",
    toneClassName:
      "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-indigo-300",
  },
  active: {
    label: "In Progress",
    dotClassName: "bg-emerald-500",
    toneClassName:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300",
  },
  completed: {
    label: "Completed",
    dotClassName: "bg-zinc-400 dark:bg-zinc-500",
    toneClassName:
      "border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300",
  },
};

export const SPRINT_TASK_STATUS_PRESENTATION: Record<
  SprintTaskStatus,
  {
    label: string;
    toneClassName: string;
  }
> = {
  todo: {
    label: "Queued",
    toneClassName:
      "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300",
  },
  in_progress: {
    label: "In progress",
    toneClassName:
      "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300",
  },
  done: {
    label: "Completed",
    toneClassName:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300",
  },
  blocked: {
    label: "Blocked",
    toneClassName:
      "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300",
  },
};

export const SPRINT_FILTER_LABELS: Record<SprintTimelineFilter, string> = {
  all: "All",
  work: "Work items",
  blocked: "Blocked",
  completed: "Completed",
  files: "Files",
};

const sprintRouteStateSchema = z.object({
  filter: z.enum(SPRINT_TIMELINE_FILTERS).optional(),
  mode: z.enum(SPRINT_TIMELINE_MODES).optional(),
  drawerType: z.enum(SPRINT_DRAWER_TYPES).optional(),
  drawerId: z.string().trim().min(1).optional(),
});

function clampPercentage(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function isValidSprintDate(value: string | null | undefined) {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

export function formatSprintDateRange(startDate: string | null | undefined, endDate: string | null | undefined) {
  const start = isValidSprintDate(startDate) ? new Date(startDate as string) : null;
  const end = isValidSprintDate(endDate) ? new Date(endDate as string) : null;

  if (start && end) {
    return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${end.toLocaleDateString(
      "en-US",
      { month: "short", day: "numeric", year: "numeric" },
    )}`;
  }
  if (start) {
    return `Starts ${start.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  }
  if (end) {
    return `Ends ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  }
  return "Dates not set";
}

export function pluralizeSprintUnit(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function buildSprintPermissionSet(input: {
  canRead: boolean;
  canWrite: boolean;
  isOwner: boolean;
  isMember: boolean;
  memberRole: SprintMemberRole;
}): SprintPermissionSet {
  const canManage = input.canWrite;
  return {
    canRead: input.canRead,
    canWrite: input.canWrite,
    canCreate: canManage,
    canStart: canManage,
    canComplete: canManage,
    isOwner: input.isOwner,
    isMember: input.isMember,
    memberRole: input.memberRole,
  };
}

export function buildSprintHealthSummary(input: {
  totalTasks: number;
  completedTasks: number;
  blockedTasks: number;
  linkedFileCount: number;
  totalStoryPoints: number;
  completedStoryPoints: number;
}): SprintHealthSummary {
  return {
    totalTasks: Math.max(0, input.totalTasks),
    completedTasks: Math.max(0, input.completedTasks),
    blockedTasks: Math.max(0, input.blockedTasks),
    linkedFileCount: Math.max(0, input.linkedFileCount),
    totalStoryPoints: Math.max(0, input.totalStoryPoints),
    completedStoryPoints: Math.max(0, input.completedStoryPoints),
    completionPercentage:
      input.totalTasks > 0
        ? clampPercentage((input.completedTasks / input.totalTasks) * 100)
        : 0,
  };
}

export function buildSprintFilterCounts(input: {
  totalTasks: number;
  completedTasks: number;
  blockedTasks: number;
  linkedFileCount: number;
}): SprintFilterCounts {
  const workCount = Math.max(0, input.totalTasks);
  const fileCount = Math.max(0, input.linkedFileCount);
  return {
    all: workCount + fileCount,
    work: workCount,
    blocked: Math.max(0, input.blockedTasks),
    completed: Math.max(0, input.completedTasks),
    files: fileCount,
  };
}

export function filterSprintTimelineRows(rows: SprintTimelineRow[], filter: SprintTimelineFilter) {
  if (filter === "all") return rows;

  return rows.filter((row) => {
    if (row.kind === "kickoff" || row.kind === "closeout") return true;
    if (filter === "files") return row.kind === "file";
    if (filter === "work") return row.kind === "task";
    if (filter === "blocked") return row.kind === "task" && row.task.status === "blocked";
    if (filter === "completed") return row.kind === "task" && row.task.status === "done";
    return true;
  });
}

export function parseSprintRouteState(input: URLSearchParams | SearchParamsReader | Record<string, string | string[] | undefined>) {
  const source =
    input instanceof URLSearchParams
      ? {
          filter: input.get("filter") ?? undefined,
          mode: input.get("mode") ?? undefined,
          drawerType: input.get("drawerType") ?? undefined,
          drawerId: input.get("drawerId") ?? undefined,
        }
      : isSearchParamsReader(input)
        ? {
            filter: input.get("filter") ?? undefined,
            mode: input.get("mode") ?? undefined,
            drawerType: input.get("drawerType") ?? undefined,
            drawerId: input.get("drawerId") ?? undefined,
          }
        : {
            filter: Array.isArray(input.filter) ? input.filter[0] : input.filter,
            mode: Array.isArray(input.mode) ? input.mode[0] : input.mode,
            drawerType: Array.isArray(input.drawerType) ? input.drawerType[0] : input.drawerType,
            drawerId: Array.isArray(input.drawerId) ? input.drawerId[0] : input.drawerId,
          };

  const parsed = sprintRouteStateSchema.safeParse(source);
  if (!parsed.success) {
    return {
      filter: "all" as SprintTimelineFilter,
      mode: "chronological" as SprintTimelineMode,
      drawer: { type: "none", id: null } as SprintDrawerState,
      hasExplicitFilter: false,
      hasExplicitMode: false,
    };
  }

  const filter = parsed.data.filter ?? "all";
  const mode = parsed.data.mode ?? "chronological";
  const drawer =
    parsed.data.drawerType && parsed.data.drawerId
      ? ({ type: parsed.data.drawerType, id: parsed.data.drawerId } as SprintDrawerState)
      : ({ type: "none", id: null } as SprintDrawerState);

  return {
    filter,
    mode,
    drawer,
    hasExplicitFilter: parsed.data.filter !== undefined,
    hasExplicitMode: parsed.data.mode !== undefined,
  };
}

export function buildSprintRouteQuery(input: {
  filter?: SprintTimelineFilter;
  mode?: SprintTimelineMode;
  drawer?: SprintDrawerState;
  preserveTab?: boolean;
}) {
  const params = new URLSearchParams();
  if (input.preserveTab) {
    params.set("tab", "sprints");
  }
  if (input.filter && input.filter !== "all") {
    params.set("filter", input.filter);
  }
  if (input.mode && input.mode !== "chronological") {
    params.set("mode", input.mode);
  }
  if (input.drawer && input.drawer.type !== "none") {
    params.set("drawerType", input.drawer.type);
    params.set("drawerId", input.drawer.id);
  }
  return params;
}

export function buildProjectSprintTabHref(projectSlug: string, input?: {
  filter?: SprintTimelineFilter;
  mode?: SprintTimelineMode;
  drawer?: SprintDrawerState;
}) {
  const query = buildSprintRouteQuery({
    preserveTab: true,
    filter: input?.filter,
    mode: input?.mode,
    drawer: input?.drawer,
  }).toString();
  return query ? `/projects/${projectSlug}?${query}` : `/projects/${projectSlug}?tab=sprints`;
}

export function buildProjectSprintDetailHref(projectSlug: string, sprintId: string, input?: {
  filter?: SprintTimelineFilter;
  mode?: SprintTimelineMode;
  drawer?: SprintDrawerState;
}) {
  const query = buildSprintRouteQuery({
    filter: input?.filter,
    mode: input?.mode,
    drawer: input?.drawer,
  }).toString();
  const base = `/projects/${projectSlug}/sprints/${sprintId}`;
  return query ? `${base}?${query}` : base;
}
