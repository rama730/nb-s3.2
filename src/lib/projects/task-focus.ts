import type { TaskSurfaceRecord } from "@/lib/projects/task-presentation";
import type { TaskPriority } from "@/lib/projects/task-workflow";
import { getWorkspaceCounterWindow, isWorkspaceTaskDueToday, isWorkspaceTaskOverdue } from "@/lib/workspace/counter-logic";

export const FOCUS_STRIP_COMFORTABLE_MIN_WIDTH = 520;
export const FOCUS_STRIP_PREVIEW_LIMIT = 4;

export type FocusStripMode = "comfortable" | "compact";
export type FocusTaskUrgency = "overdue" | "due_today" | "blocked" | "normal";

const FOCUS_URGENCY_RANK: Record<FocusTaskUrgency, number> = {
    overdue: 0,
    due_today: 1,
    blocked: 2,
    normal: 3,
};

const FOCUS_PRIORITY_RANK: Record<TaskPriority, number> = {
    urgent: 0,
    high: 1,
    medium: 2,
    low: 3,
};

function parseFocusTimestamp(value: string | null | undefined) {
    if (!value) return 0;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function parseFocusDueDate(value: string | null | undefined) {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getFocusStripMode(
    taskCount: number,
    containerWidth: number | null | undefined,
    comfortableMinWidth: number = FOCUS_STRIP_COMFORTABLE_MIN_WIDTH,
): FocusStripMode {
    return taskCount <= 2
        && typeof containerWidth === "number"
        && containerWidth >= comfortableMinWidth
        ? "comfortable"
        : "compact";
}

export function getFocusDescriptionLineClamp(
    mode: FocusStripMode,
    taskCount: number,
    description: string | null | undefined,
): 0 | 1 | 2 {
    if (!description?.trim() || mode !== "comfortable") return 0;
    if (taskCount === 1) return 2;
    if (taskCount === 2) return 1;
    return 0;
}

export function getFocusTaskUrgency(
    task: Pick<TaskSurfaceRecord, "dueDate" | "status">,
    referenceNow: Date = new Date(),
): FocusTaskUrgency {
    const dueDate = parseFocusDueDate(task.dueDate);

    if (dueDate) {
        const { now, todayEnd } = getWorkspaceCounterWindow(referenceNow);
        if (isWorkspaceTaskOverdue(dueDate, task.status, now)) {
            return "overdue";
        }
        if (isWorkspaceTaskDueToday(dueDate, task.status, now, todayEnd)) {
            return "due_today";
        }
    }

    if (task.status === "blocked") {
        return "blocked";
    }

    return "normal";
}

export function compareFocusTasks(
    left: TaskSurfaceRecord,
    right: TaskSurfaceRecord,
    referenceNow: Date = new Date(),
) {
    const leftUrgency = getFocusTaskUrgency(left, referenceNow);
    const rightUrgency = getFocusTaskUrgency(right, referenceNow);
    const urgencyDelta = FOCUS_URGENCY_RANK[leftUrgency] - FOCUS_URGENCY_RANK[rightUrgency];
    if (urgencyDelta !== 0) return urgencyDelta;

    const priorityDelta = FOCUS_PRIORITY_RANK[left.priority] - FOCUS_PRIORITY_RANK[right.priority];
    if (priorityDelta !== 0) return priorityDelta;

    const updatedAtDelta = parseFocusTimestamp(right.updatedAt) - parseFocusTimestamp(left.updatedAt);
    if (updatedAtDelta !== 0) return updatedAtDelta;

    const createdAtDelta = parseFocusTimestamp(right.createdAt) - parseFocusTimestamp(left.createdAt);
    if (createdAtDelta !== 0) return createdAtDelta;

    return left.id.localeCompare(right.id);
}

export function rankFocusTasks(tasks: TaskSurfaceRecord[], referenceNow: Date = new Date()) {
    return [...tasks].sort((left, right) => compareFocusTasks(left, right, referenceNow));
}
