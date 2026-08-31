export type TaskDragPreview = {
    taskId: string;
    columnId: string;
    beforeTaskId: string | null;
};

type WorkflowColumn = {
    id: string;
    status: string;
    isDefault?: boolean | null;
};

type PreviewTask = {
    id: string;
    workflowColumnId?: string | null;
    status: string;
    position?: number | null;
};

export function getTaskWorkflowColumnId<T extends PreviewTask>(
    task: T,
    workflow: WorkflowColumn[],
) {
    return task.workflowColumnId
        ?? workflow.find((column) => column.isDefault && column.status === task.status)?.id
        ?? null;
}

/**
 * Produces a display-only arrangement while a task is being dragged. Durable
 * task state, caches, and realtime synchronization are intentionally untouched
 * until the drop has been confirmed.
 */
export function buildTaskPreviewColumns<T extends PreviewTask>(
    tasks: T[],
    workflow: WorkflowColumn[],
    preview: TaskDragPreview | null,
): Record<string, T[]> {
    const columns: Record<string, T[]> = Object.fromEntries(
        workflow.map((column) => [column.id, [] as T[]]),
    );

    for (const task of tasks) {
        const columnId = getTaskWorkflowColumnId(task, workflow);
        if (columnId && columns[columnId]) columns[columnId].push(task);
    }

    for (const columnTasks of Object.values(columns)) {
        columnTasks.sort((left, right) => (right.position ?? 0) - (left.position ?? 0));
    }

    if (!preview) return columns;

    const task = tasks.find((candidate) => candidate.id === preview.taskId);
    const destinationColumn = workflow.find((column) => column.id === preview.columnId);
    if (!task || !destinationColumn || !columns[destinationColumn.id]) return columns;

    const sourceColumnId = getTaskWorkflowColumnId(task, workflow);
    if (sourceColumnId && columns[sourceColumnId]) {
        columns[sourceColumnId] = columns[sourceColumnId].filter(
            (candidate) => candidate.id !== task.id,
        );
    }

    const destinationTasks = columns[destinationColumn.id]!;
    const beforeIndex = preview.beforeTaskId
        ? destinationTasks.findIndex((candidate) => candidate.id === preview.beforeTaskId)
        : -1;
    const insertionIndex = beforeIndex >= 0 ? beforeIndex : destinationTasks.length;

    destinationTasks.splice(insertionIndex, 0, {
        ...task,
        workflowColumnId: destinationColumn.id,
        status: destinationColumn.status,
    } as T);

    return columns;
}
