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
    emptyTitle: "Tasks will appear here...",
    emptyDescription: "Tasks that are ready to start will appear here. Drag and drop your tasks here.",
    badgeClassName:
      "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    accentClassName: "zinc",
  },
  in_progress: {
    id: "in_progress",
    label: "In Progress",
    description: "Work that is actively moving.",
    columnTitle: "In Progress",
    emptyTitle: "Tasks will appear here...",
    emptyDescription: "Items will appear here as soon as they start. Drag and drop your tasks here.",
    badgeClassName:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    accentClassName: "blue",
  },
  blocked: {
    id: "blocked",
    label: "Issues",
    description: "Work waiting on an external dependency or decision.",
    columnTitle: "Issues",
    emptyTitle: "Tasks will appear here...",
    emptyDescription: "Tasks waiting on blockers will appear here. Drag and drop your tasks here.",
    badgeClassName:
      "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
    accentClassName: "rose",
  },
  done: {
    id: "done",
    label: "Done",
    description: "Work that has been completed.",
    columnTitle: "Done",
    emptyTitle: "Tasks will appear here...",
    emptyDescription: "Finished work will appear here. Drag and drop your tasks here.",
    badgeClassName:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    accentClassName: "emerald",
  },
};

export const TASK_PRIORITY_PRESENTATION: Record<TaskPriority, TaskPriorityPresentation> = {
  low: {
    id: "low",
    label: "Low",
    badgeClassName:
      "bg-rose-50 text-rose-500 dark:bg-rose-950/20 dark:text-rose-300",
  },
  medium: {
    id: "medium",
    label: "Medium",
    badgeClassName:
      "bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300",
  },
  high: {
    id: "high",
    label: "High",
    badgeClassName:
      "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  },
  urgent: {
    id: "urgent",
    label: "Urgent",
    badgeClassName:
      "bg-red-600 text-white dark:bg-red-700 dark:text-white",
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
