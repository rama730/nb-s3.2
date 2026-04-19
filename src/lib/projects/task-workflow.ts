export const TASK_WORKFLOW_STATUSES = ["todo", "in_progress", "blocked", "done"] as const;
export const TASK_PRIORITY_VALUES = ["low", "medium", "high", "urgent"] as const;

export type TaskWorkflowStatus = (typeof TASK_WORKFLOW_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITY_VALUES)[number];

export type TaskWorkflowStatusPresentation = {
  id: TaskWorkflowStatus;
  label: string;
  description: string;
  columnTitle: string;
  emptyTitle: string;
  emptyDescription: string;
  badgeClassName: string;
  accentClassName: string;
};

export type TaskPriorityPresentation = {
  id: TaskPriority;
  label: string;
  badgeClassName: string;
};

export const TASK_STATUS_PRESENTATION: Record<TaskWorkflowStatus, TaskWorkflowStatusPresentation> = {
  todo: {
    id: "todo",
    label: "To Do",
    description: "Work that is ready to start.",
    columnTitle: "To Do",
    emptyTitle: "No tasks ready",
    emptyDescription: "New or unstarted work will appear here.",
    badgeClassName:
      "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    accentClassName: "bg-zinc-500",
  },
  in_progress: {
    id: "in_progress",
    label: "In Progress",
    description: "Work that is actively moving.",
    columnTitle: "In Progress",
    emptyTitle: "Nothing in flight",
    emptyDescription: "Active work will appear here as soon as it starts.",
    badgeClassName:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    accentClassName: "bg-blue-500",
  },
  blocked: {
    id: "blocked",
    label: "Blocked",
    description: "Work waiting on an external dependency or decision.",
    columnTitle: "Blocked",
    emptyTitle: "No blocked tasks",
    emptyDescription: "Tasks waiting on blockers will appear here.",
    badgeClassName:
      "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
    accentClassName: "bg-rose-500",
  },
  done: {
    id: "done",
    label: "Done",
    description: "Work that has been completed.",
    columnTitle: "Done",
    emptyTitle: "Nothing completed yet",
    emptyDescription: "Finished work will appear here once it is done.",
    badgeClassName:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    accentClassName: "bg-emerald-500",
  },
};

export const TASK_PRIORITY_PRESENTATION: Record<TaskPriority, TaskPriorityPresentation> = {
  low: {
    id: "low",
    label: "Low",
    badgeClassName:
      "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  },
  medium: {
    id: "medium",
    label: "Medium",
    badgeClassName:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  },
  high: {
    id: "high",
    label: "High",
    badgeClassName:
      "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  },
  urgent: {
    id: "urgent",
    label: "Urgent",
    badgeClassName:
      "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
  },
};

export const TASK_BOARD_COLUMNS = TASK_WORKFLOW_STATUSES.map((status) => ({
  id: status,
  title: TASK_STATUS_PRESENTATION[status].columnTitle,
  emptyTitle: TASK_STATUS_PRESENTATION[status].emptyTitle,
  emptyDescription: TASK_STATUS_PRESENTATION[status].emptyDescription,
  accentClassName: TASK_STATUS_PRESENTATION[status].accentClassName,
})) as ReadonlyArray<{
  id: TaskWorkflowStatus;
  title: string;
  emptyTitle: string;
  emptyDescription: string;
  accentClassName: string;
}>;

export function isTaskWorkflowStatus(value: string | null | undefined): value is TaskWorkflowStatus {
  return !!value && TASK_WORKFLOW_STATUSES.includes(value as TaskWorkflowStatus);
}

export function isTaskPriority(value: string | null | undefined): value is TaskPriority {
  return !!value && TASK_PRIORITY_VALUES.includes(value as TaskPriority);
}

export function getTaskStatusPresentation(status: string | null | undefined): TaskWorkflowStatusPresentation {
  return TASK_STATUS_PRESENTATION[isTaskWorkflowStatus(status) ? status : "todo"];
}

export function getTaskPriorityPresentation(priority: string | null | undefined): TaskPriorityPresentation {
  return TASK_PRIORITY_PRESENTATION[isTaskPriority(priority) ? priority : "medium"];
}

