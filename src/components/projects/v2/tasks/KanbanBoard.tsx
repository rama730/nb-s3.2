"use client";

import React, { useMemo, useState, useEffect, useRef } from "react";
import {
  getColumnColors,
  parseSemanticColor,
  WORKFLOW_COLORS,
  type SemanticColor,
} from "@/lib/projects/workflow-colors";
import {
  Check,
  MoreHorizontal,
  Pencil,
  Trash2,
  GripVertical,
  Palette,
} from "lucide-react";
import { TaskCard, Task } from "./TaskCard";
import { cn } from "@/lib/utils";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  DragCancelEvent,
  defaultDropAnimationSideEffects,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { moveTaskToWorkflowColumnAction } from "@/app/actions/task";
import { toast } from "sonner";
import { patchProjectTaskCaches } from "@/lib/projects/task-cache";
import {
  buildTaskPreviewColumns,
  getTaskWorkflowColumnId,
  type TaskDragPreview,
} from "@/lib/projects/task-drag-preview";
import { useQueryClient } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";

type TaskDropTarget = Omit<TaskDragPreview, "taskId">;

const SortableTaskCard = React.memo(function SortableTaskCard({
  task,
  onClick,
  activeAssignableMemberIds,
  isLeader,
  currentUserId,
  isDragLocked,
  onMeasure,
}: {
  task: Task;
  onClick: (task: Task) => void;
  activeAssignableMemberIds?: Set<string>;
  isLeader?: boolean;
  currentUserId?: string;
  isDragLocked?: boolean;
  onMeasure: (taskId: string, node: HTMLDivElement) => void;
}) {
  const canDrag =
    !isDragLocked &&
    (isLeader || !task.assigneeId || task.assigneeId === currentUserId);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: { type: "Task", task },
    disabled: !canDrag,
    transition: {
      duration: 300,
      easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)",
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging
      ? undefined
      : (transition ?? "transform 300ms cubic-bezier(0.18, 0.67, 0.6, 1.22)"),
  };
  const setTaskNodeRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      if (node) onMeasure(task.id, node);
    },
    [onMeasure, setNodeRef, task.id],
  );

  if (isDragging) {
    return (
      <div
        ref={setTaskNodeRef}
        style={style}
        className="relative touch-manipulation"
      >
        <div className="invisible">
          <TaskCard task={task} />
        </div>
        <div className="absolute inset-0 rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-100/40 dark:border-zinc-700 dark:bg-zinc-800/20" />
      </div>
    );
  }

  return (
    <div
      ref={setTaskNodeRef}
      style={style}
      className="will-change-transform"
      {...(canDrag ? attributes : {})}
      {...(canDrag ? listeners : {})}
    >
      <TaskCard
        task={task}
        onClick={onClick}
        activeAssignableMemberIds={activeAssignableMemberIds}
      />
    </div>
  );
});

const KanbanColumn = React.memo(
  function KanbanColumn({
    col,
    colTasks,
    visibleLimit,
    onTaskClick,
    activeAssignableMemberIds,
    setVisibleCounts,
    STEP,
    onRenameColumn,
    onChangeColor,
    onRemoveColumn,
    isLeader,
    currentUserId,
    onTaskMeasure,
    isTaskDragLocked,
  }: any) {
    const canReorderColumns = isLeader;

    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({
      id: col.id,
      data: { type: "Column", column: col },
      disabled: !canReorderColumns,
      transition: {
        duration: 300,
        easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)",
      },
    });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition: isDragging
        ? undefined
        : (transition ?? "transform 300ms cubic-bezier(0.18, 0.67, 0.6, 1.22)"),
    };
    const visibleTasks = colTasks.slice(0, visibleLimit);
    const hasMoreInColumn = colTasks.length > visibleLimit;

    const [isEditing, setIsEditing] = useState(false);
    const [title, setTitle] = useState(col.title);
    const [dropdownOpen, setDropdownOpen] = useState(false);

    const handleBlur = () => {
      setIsEditing(false);
      if (title !== col.title && title.trim().length > 0) {
        onRenameColumn(col.id, title.trim());
      } else {
        setTitle(col.title); // revert if empty
      }
    };

    const handleColorClick = (c: any) => {
      onChangeColor(col.id, c);
      setDropdownOpen(false);
    };

    const colors = getColumnColors(col.accentClassName);

    return (
      <div
        ref={setNodeRef}
        style={style}
        role="region"
        aria-label={`${col.title} column, ${colTasks.length} tasks`}
        className={cn(
          "group h-max w-[300px] shrink-0 rounded-xl border flex flex-col transition-all",
          colors.bg,
          colors.border,
          isDragging && "opacity-45 border-primary/30",
        )}
      >
        <div
          className={cn(
            "p-4 shrink-0 flex items-center justify-between border-b rounded-t-xl",
            colors.border,
          )}
        >
          <div className="flex items-center gap-2 flex-1">
            {isEditing ? (
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={handleBlur}
                onKeyDown={(e) => e.key === "Enter" && handleBlur()}
                className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 bg-transparent border-none outline-none w-full"
              />
            ) : (
              <div className="flex items-center gap-2 flex-1">
                <h3
                  className={cn(
                    "font-semibold text-sm truncate max-w-[150px]",
                    colors.text,
                  )}
                  title={col.title}
                >
                  {col.title}
                </h3>
                <span
                  className={cn(
                    "px-2 py-0.5 rounded-full text-xs font-bold border",
                    colors.bg.replace("/50", ""),
                    colors.border,
                    colors.text,
                  )}
                >
                  {colTasks.length}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            {isLeader ? (
              <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
                <DropdownMenuTrigger className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">
                  <MoreHorizontal className="w-4 h-4 text-zinc-500" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {!isEditing && isLeader && (
                    <>
                      <DropdownMenuItem
                        className="cursor-pointer"
                        onSelect={(e) => {
                          e.preventDefault();
                          setIsEditing(true);
                          setDropdownOpen(false);
                        }}
                      >
                        <Pencil className="w-4 h-4 mr-2" />
                        Rename Section
                      </DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger className="cursor-pointer">
                          <Palette className="w-4 h-4 mr-2" />
                          Change Color
                        </DropdownMenuSubTrigger>
                        <DropdownMenuPortal>
                          <DropdownMenuSubContent className="w-40">
                            <div className="p-2 grid grid-cols-4 gap-2">
                              {WORKFLOW_COLORS.map((c) => {
                                const cMap = getColumnColors(c);
                                const isSelected =
                                  parseSemanticColor(
                                    col.accentClassName || "zinc",
                                  ) === c;
                                return (
                                  <button
                                    type="button"
                                    key={c}
                                    aria-label={`Use ${c} for ${col.title}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleColorClick(c);
                                    }}
                                    className={cn(
                                      "w-6 h-6 rounded-full cursor-pointer flex items-center justify-center transition-all hover:scale-110",
                                      cMap.dot,
                                      isSelected &&
                                        "ring-2 ring-offset-1 ring-zinc-400 dark:ring-zinc-500 scale-110",
                                    )}
                                  >
                                    {isSelected && (
                                      <Check
                                        className="w-3.5 h-3.5 text-white drop-shadow-sm"
                                        strokeWidth={3}
                                      />
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </DropdownMenuSubContent>
                        </DropdownMenuPortal>
                      </DropdownMenuSub>
                    </>
                  )}
                  {!col.isDefault && isLeader && (
                    <DropdownMenuItem
                      className="text-rose-600 focus:text-rose-600 cursor-pointer"
                      onClick={() => onRemoveColumn(col.id)}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Remove Section
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {canReorderColumns && (
              <button
                type="button"
                aria-label={`Reorder ${col.title}`}
                {...attributes}
                {...listeners}
                className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded cursor-grab active:cursor-grabbing text-zinc-400"
              >
                <GripVertical className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <div className="p-3 space-y-3 min-h-[150px] flex-1 flex flex-col">
          <SortableContext
            items={visibleTasks.map((t: Task) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            {visibleTasks.length > 0 ? (
              <>
                {visibleTasks.map((task: Task) => (
                  <SortableTaskCard
                    key={task.id}
                    task={task}
                    onClick={onTaskClick}
                    activeAssignableMemberIds={activeAssignableMemberIds}
                    isLeader={isLeader}
                    currentUserId={currentUserId}
                    isDragLocked={isTaskDragLocked}
                    onMeasure={onTaskMeasure}
                  />
                ))}
                {hasMoreInColumn && (
                  <button
                    onClick={() =>
                      setVisibleCounts((prev: any) => ({
                        ...prev,
                        [col.id]: Math.min(
                          colTasks.length,
                          prev[col.id] + STEP,
                        ),
                      }))
                    }
                    className="w-full py-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 border border-dashed border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                  >
                    Show more
                  </button>
                )}
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-zinc-400 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg opacity-50">
                <p className="text-xs font-medium">
                  {col.emptyTitle || "No tasks here"}
                </p>
                <p className="mt-1 text-[11px] text-zinc-400 text-center max-w-[200px]">
                  {col.emptyDescription || "Drag tasks into this section"}
                </p>
              </div>
            )}
          </SortableContext>
        </div>
      </div>
    );
  },
  (prev, next) => {
    // Ponytail optimization: Only re-render column if its specific tasks changed reference or order.
    if (prev.col.id !== next.col.id) return false;
    if (prev.visibleLimit !== next.visibleLimit) return false;
    if (prev.col.title !== next.col.title) return false;
    if (prev.col.accentClassName !== next.col.accentClassName) return false;

    if (prev.colTasks.length !== next.colTasks.length) return false;
    for (let i = 0; i < prev.colTasks.length; i++) {
      // If task object reference changed (e.g. title updated), re-render column so SortableTaskCard can re-render.
      if (prev.colTasks[i] !== next.colTasks[i]) return false;
    }

    return true;
  },
);

interface KanbanBoardProps {
  projectId: string;
  workflow: any[];
  tasks: Task[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  activeAssignableMemberIds?: Set<string>;
  isLeader?: boolean;
  currentUserId?: string;
  onTaskDragStateChange?: (taskId: string | null) => void;
  onRenameColumn: (id: string, newTitle: string) => void;
  onChangeColor: (id: string, newColor: SemanticColor) => void;
  onRemoveColumn: (id: string) => void;
  onReorderColumns: (newOrder: any[]) => void;
  onTaskClick: (task: Task) => void;
  fetchNextPage: () => void;
}

export default function KanbanBoard({
  projectId,
  workflow,
  tasks: initialTasks,
  hasNextPage,
  isFetchingNextPage,
  activeAssignableMemberIds,
  isLeader,
  currentUserId,
  onTaskDragStateChange,
  onRenameColumn,
  onChangeColor,
  onRemoveColumn,
  onReorderColumns,
  onTaskClick,
  fetchNextPage,
}: KanbanBoardProps) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);

  useEffect(() => setTasks(initialTasks), [initialTasks]);

  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [activeTaskWidth, setActiveTaskWidth] = useState<number | null>(null);
  const [activeColumn, setActiveColumn] = useState<any | null>(null);
  const [previewMove, setPreviewMove] = useState<TaskDragPreview | null>(null);
  const queryClient = useQueryClient();
  const dragTasksRef = React.useRef<Task[] | null>(null);
  const taskMovePendingRef = React.useRef(false);
  const [isTaskMovePending, setIsTaskMovePending] = useState(false);

  const taskSizesRef = React.useRef(
    new Map<string, { width: number; height: number }>(),
  );
  const measureTask = React.useCallback(
    (taskId: string, node: HTMLDivElement) => {
      const { width, height } = node.getBoundingClientRect();
      if (width > 0 && height > 0)
        taskSizesRef.current.set(taskId, { width, height });
    },
    [],
  );

  const DEFAULT_VISIBLE = 20;
  const STEP = 20;
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>(
    {},
  );

  const columns = useMemo(
    () => buildTaskPreviewColumns(tasks, workflow, previewMove),
    [previewMove, tasks, workflow],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const getWorkflowColumnId = React.useCallback(
    (task: Task) => getTaskWorkflowColumnId(task, workflow),
    [workflow],
  );

  const resolveTaskDropTarget = React.useCallback(
    (over: DragOverEvent["over"]): TaskDropTarget | null => {
      if (!over) return null;
      if (over.data.current?.type === "Task") {
        const overTask =
          (over.data.current.task as Task | undefined) ??
          tasks.find((task) => task.id === over.id);
        const columnId = overTask ? getWorkflowColumnId(overTask) : null;
        return columnId
          ? { columnId, beforeTaskId: overTask?.id ?? null }
          : null;
      }

      if (over.data.current?.type === "Column") {
        const overColumn = workflow.find((column) => column.id === over.id);
        return overColumn
          ? { columnId: overColumn.id, beforeTaskId: null }
          : null;
      }

      return null;
    },
    [getWorkflowColumnId, tasks, workflow],
  );

  function onDragStart(event: DragStartEvent) {
    dragTasksRef.current = tasks;
    if (event.active.data.current?.type === "Task") {
      const task = event.active.data.current.task as Task;
      const taskSize = taskSizesRef.current.get(task.id);
      setActiveTask(task);
      setActiveTaskWidth(
        taskSize?.width ?? event.active.rect.current.initial?.width ?? null,
      );
      setPreviewMove(null);
      onTaskDragStateChange?.(task.id);
    }
    if (event.active.data.current?.type === "Column") {
      setActiveColumn(event.active.data.current.column);
    }
  }

  function clearDragSnapshot() {
    dragTasksRef.current = null;
  }

  function restoreDraggedTask() {
    if (dragTasksRef.current) setTasks(dragTasksRef.current);
    queryClient.invalidateQueries({
      queryKey: ["project", projectId, "detail", "tasks"],
    });
    clearDragSnapshot();
  }

  function onDragOver(event: DragOverEvent) {
    if (event.active.data.current?.type !== "Task") return;
    // The transient slot can become the closest collision after it moves.
    // Keep the last meaningful target instead of clearing and re-adding it.
    if (event.active.id === event.over?.id) return;
    const nextTarget = resolveTaskDropTarget(event.over);
    const nextPreview = nextTarget
      ? { taskId: String(event.active.id), ...nextTarget }
      : null;
    setPreviewMove((current) =>
      current?.taskId === nextPreview?.taskId &&
      current?.columnId === nextPreview?.columnId &&
      current?.beforeTaskId === nextPreview?.beforeTaskId
        ? current
        : nextPreview,
    );
  }

  async function onDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    setActiveTaskWidth(null);
    setActiveColumn(null);
    const { active, over } = event;
    const dragPreview =
      previewMove?.taskId === String(active.id) ? previewMove : null;
    setPreviewMove(null);
    if (!over) {
      clearDragSnapshot();
      onTaskDragStateChange?.(null);
      return;
    }

    if (
      active.data.current?.type === "Column" &&
      over.data.current?.type === "Column"
    ) {
      const activeId = active.id;
      const overId = over.id;
      if (activeId === overId) return;
      const activeIndex = workflow.findIndex((w) => w.id === activeId);
      const overIndex = workflow.findIndex((w) => w.id === overId);
      if (activeIndex < 0 || overIndex < 0) return;
      const newWorkflow = arrayMove(workflow, activeIndex, overIndex);
      onReorderColumns(newWorkflow);
      clearDragSnapshot();
      return;
    }

    if (active.data.current?.type !== "Task") {
      clearDragSnapshot();
      onTaskDragStateChange?.(null);
      return;
    }

    if (taskMovePendingRef.current) {
      restoreDraggedTask();
      onTaskDragStateChange?.(null);
      toast.error("Wait for the current task move to finish.");
      return;
    }

    const target =
      dragPreview ??
      (active.id === over.id ? null : resolveTaskDropTarget(over));
    const snapshot = dragTasksRef.current ?? tasks;
    const draggedTask = snapshot.find((task) => task.id === active.id);
    const targetColumn = target
      ? workflow.find((column) => column.id === target.columnId)
      : null;
    if (!draggedTask || !target || !targetColumn) {
      clearDragSnapshot();
      onTaskDragStateChange?.(null);
      return;
    }

    const destinationTasks = snapshot
      .filter(
        (task) =>
          task.id !== draggedTask.id &&
          getWorkflowColumnId(task) === target.columnId,
      )
      .sort((left, right) => (right.position ?? 0) - (left.position ?? 0));
    const beforeIndex = target.beforeTaskId
      ? destinationTasks.findIndex((task) => task.id === target.beforeTaskId)
      : destinationTasks.length;
    const insertionIndex =
      beforeIndex < 0 ? destinationTasks.length : beforeIndex;
    const previousTask = destinationTasks[insertionIndex - 1];
    const nextTask = destinationTasks[insertionIndex];
    const sourceColumnId = getWorkflowColumnId(draggedTask);
    const sourceTasks = snapshot.filter(
      (task) => getWorkflowColumnId(task) === sourceColumnId,
    );
    const sourceIndex = sourceTasks.findIndex(
      (task) => task.id === draggedTask.id,
    );
    const unchanged =
      sourceColumnId === target.columnId &&
      ((!target.beforeTaskId && sourceIndex === sourceTasks.length - 1) ||
        target.beforeTaskId === sourceTasks[sourceIndex + 1]?.id);

    if (unchanged) {
      clearDragSnapshot();
      onTaskDragStateChange?.(null);
      return;
    }

    // ponytail: float64 gaps avoid rewriting every card; use Lexorank only if repeated midpoint moves exhaust precision.
    const POSITION_GAP = 60000;
    const newPosition =
      previousTask && nextTask
        ? ((previousTask.position ?? 0) + (nextTask.position ?? 0)) / 2
        : nextTask
          ? (nextTask.position ?? 0) + POSITION_GAP
          : previousTask
            ? (previousTask.position ?? 0) - POSITION_GAP
            : (draggedTask.position ?? 0);
    const updatedTask = {
      ...draggedTask,
      workflowColumnId: targetColumn.id,
      status: targetColumn.status,
      position: newPosition,
    };

    setTasks((current) =>
      current.map((task) => (task.id === updatedTask.id ? updatedTask : task)),
    );
    patchProjectTaskCaches(queryClient, projectId, updatedTask, {
      reconcile: false,
    });

    taskMovePendingRef.current = true;
    setIsTaskMovePending(true);
    try {
      const result = await moveTaskToWorkflowColumnAction(
        updatedTask.id,
        projectId,
        targetColumn.id,
        newPosition,
        draggedTask.updatedAt,
      );
      if (!result.success) {
        setTasks((current) =>
          current.map((task) =>
            task.id === draggedTask.id ? draggedTask : task,
          ),
        );
        patchProjectTaskCaches(queryClient, projectId, draggedTask, {
          reconcile: false,
        });
        void queryClient.invalidateQueries({
          queryKey: ["project", projectId, "detail", "tasks"],
        });
        toast.error("Failed to move task: " + result.error);
        return;
      }
      const persistedTask = result.updatedAt
        ? {
            ...updatedTask,
            updatedAt: result.updatedAt,
            reviewStatus: result.reviewStatus ?? updatedTask.reviewStatus,
          }
        : updatedTask;
      setTasks((current) =>
        current.map((task) =>
          task.id === persistedTask.id ? persistedTask : task,
        ),
      );
      patchProjectTaskCaches(queryClient, projectId, persistedTask, {
        reconcile: false,
      });
    } catch (error) {
      setTasks((current) =>
        current.map((task) =>
          task.id === draggedTask.id ? draggedTask : task,
        ),
      );
      patchProjectTaskCaches(queryClient, projectId, draggedTask, {
        reconcile: false,
      });
      void queryClient.invalidateQueries({
        queryKey: ["project", projectId, "detail", "tasks"],
      });
      toast.error(
        error instanceof Error ? error.message : "Failed to move task",
      );
    } finally {
      taskMovePendingRef.current = false;
      setIsTaskMovePending(false);
      clearDragSnapshot();
      onTaskDragStateChange?.(null);
    }
  }

  function onDragCancel(_: DragCancelEvent) {
    setActiveTask(null);
    setActiveTaskWidth(null);
    setActiveColumn(null);
    setPreviewMove(null);
    clearDragSnapshot();
    onTaskDragStateChange?.(null);
  }

  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const prevWorkflowLengthRef = React.useRef(workflow.length);

  useEffect(() => {
    if (workflow.length > prevWorkflowLengthRef.current) {
      // A new section was added, scroll to the end smoothly
      // The DOM is already updated by the time useEffect runs.
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTo({
          left: scrollContainerRef.current.scrollWidth,
          behavior: "smooth",
        });
      }
    }
    prevWorkflowLengthRef.current = workflow.length;
  }, [workflow.length]);

  return (
    <div className="space-y-4">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        autoScroll={{
          acceleration: 12,
          interval: 5,
          threshold: { x: 0.14, y: 0.14 },
        }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <SortableContext
          items={workflow.map((w) => w.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div
            ref={scrollContainerRef}
            className="flex items-start gap-6 overflow-x-auto overscroll-x-contain pb-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
          >
            <div className="my-auto ml-auto shrink-0" aria-hidden="true" />
            {workflow.map((col) => {
              const visibleLimit = visibleCounts[col.id] || DEFAULT_VISIBLE;
              return (
                <KanbanColumn
                  key={col.id}
                  col={col}
                  colTasks={columns[col.id] || []}
                  visibleLimit={visibleLimit}
                  onTaskClick={onTaskClick}
                  activeAssignableMemberIds={activeAssignableMemberIds}
                  setVisibleCounts={setVisibleCounts}
                  STEP={STEP}
                  onRenameColumn={onRenameColumn}
                  onChangeColor={onChangeColor}
                  onRemoveColumn={onRemoveColumn}
                  isLeader={isLeader}
                  currentUserId={currentUserId}
                  onTaskMeasure={measureTask}
                  isTaskDragLocked={hasNextPage || isTaskMovePending}
                />
              );
            })}
            <div className="my-auto mr-auto shrink-0" aria-hidden="true" />
          </div>
        </SortableContext>

        <DragOverlay
          adjustScale={false}
          dropAnimation={{
            duration: 300,
            easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)",
            sideEffects: defaultDropAnimationSideEffects({
              styles: { active: { opacity: "0.15" } },
            }),
          }}
        >
          {activeTask ? (
            // ponytail: one moving card; source and destination render blank slots only.
            <div
              className="pointer-events-none w-[min(360px,calc(100vw-2rem))] cursor-grabbing rounded-lg shadow-xl ring-1 ring-black/5"
              style={{
                width:
                  activeTaskWidth && activeTaskWidth > 0
                    ? activeTaskWidth
                    : undefined,
              }}
            >
              <TaskCard task={activeTask} />
            </div>
          ) : null}
          {activeColumn ? (
            <div className="cursor-grabbing rounded-xl shadow-xl ring-1 ring-black/5 opacity-95 max-h-[80vh] overflow-hidden">
              <KanbanColumn
                col={activeColumn}
                colTasks={columns[activeColumn.id] || []}
                visibleLimit={visibleCounts[activeColumn.id] || DEFAULT_VISIBLE}
                onTaskClick={() => {}}
                activeAssignableMemberIds={activeAssignableMemberIds}
                setVisibleCounts={() => {}}
                STEP={STEP}
                onRenameColumn={() => {}}
                onChangeColor={() => {}}
                onRemoveColumn={() => {}}
                isLeader={isLeader}
                currentUserId={currentUserId}
                onTaskMeasure={measureTask}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {hasNextPage && (
        <div className="mt-4 flex flex-col items-center gap-2">
          <p className="text-xs text-zinc-500" role="status">
            Load all tasks before reordering so positions remain complete and deterministic.
          </p>
          <button
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="px-4 py-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 border border-dashed border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors disabled:opacity-60"
          >
            {isFetchingNextPage ? "Loading more tasks..." : "Load more tasks"}
          </button>
        </div>
      )}
    </div>
  );
}
