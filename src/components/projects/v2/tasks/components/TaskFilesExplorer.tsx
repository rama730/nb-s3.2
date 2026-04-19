"use client";

/**
 * Task panel — Files tab list.
 *
 * Renders the task's linked attachments using the new `TaskFileRow`
 * component (64px-tall, fully-signposted action surfaces). Folders can
 * still expand inline to reveal their children, but the row chrome
 * stays consistent across the top level and nested children.
 *
 * The legacy right-click context menu is preserved as a parallel surface
 * to the overflow menu — long-time users keep their muscle memory while
 * everyone else gets a discoverable affordance.
 *
 * Drop handling lives in `FilesTab.tsx` (the panel-level drop zone).
 * This component just renders the list, the drop-hint strip when the
 * list is non-empty, and the dnd-kit reorder behaviour for root rows.
 */

import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { ArrowDownToLine, History, Link as LinkIcon, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui-custom/Toast";
import type { ProjectNode } from "@/lib/db/schema";
import { getProjectNodes } from "@/app/actions/files";
import { useFilesWorkspaceStore, filesParentKey } from "@/stores/filesWorkspaceStore";
import { updateTaskNodeLink, updateTaskNodeLinksOrder } from "@/app/actions/files/links";
import { TaskFileRow } from "@/components/projects/v2/tasks/components/TaskFileRow";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const EMPTY_OBJ = {} as Record<string, never>;

interface TaskFilesExplorerProps {
  taskId: string;
  projectId: string;
  /** Used to build local IDE paths, e.g. ~/Downloads/NB-Workspace/<slug>/<file>. */
  projectSlug?: string;
  linkedNodes: (ProjectNode & { order?: number; annotation?: string | null })[];
  canEdit: boolean;
  onUnlink?: (nodeId: string) => void;
  onOpenFile?: (node: ProjectNode) => void;
  /** Opens the version-history drawer for a file row. */
  onShowHistory?: (node: ProjectNode) => void;
  /** Optional deep-link into the internal Monaco workspace. */
  onOpenInWorkspace?: (node: ProjectNode) => void;
  /**
   * Forwarded from `useTaskFileMutations.saveAsNewVersion`. The row's
   * overflow menu uses this for "Replace with new version".
   */
  onReplaceWithNewVersion?: (
    node: ProjectNode,
    file: File,
  ) => Promise<{ success: boolean; error?: string }> | void;
  onReorder?: (newOrder: string[]) => void;
}

/**
 * Rows carry the concrete node (not just the id) so that first-paint
 * rendering never depends on the workspace-store useEffect having fired.
 * The legacy implementation did `nodesById[id]` at render time and, when
 * this was the first task panel opened in a session, silently returned an
 * empty list until the store caught up — the file row would simply not
 * appear until a second render that the user often never triggered.
 *
 * Roots use `localNodes` (source of truth from the task resource); child
 * rows (folder expansion) still use the store because they're fetched
 * lazily via `loadChildren`.
 */
type VisibleRow =
  | {
      kind: "node";
      node: ProjectNode & { annotation?: string | null };
      level: number;
      isRoot: boolean;
    }
  | { kind: "loading"; level: number };

function sameLinkedNodesContent(
  a: (ProjectNode & { order?: number; annotation?: string | null })[],
  b: (ProjectNode & { order?: number; annotation?: string | null })[],
) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Wrap a row in dnd-kit's sortable hooks. We forward the drag handle
 * bindings into the row so the handle itself is the activator (clicking
 * elsewhere in the row triggers Open). The wrapper itself stays a
 * passive container.
 */
function SortableRow({
  id,
  isDisabled,
  children,
}: {
  id: string;
  isDisabled: boolean;
  children: (handle: {
    attributes: Record<string, unknown>;
    listeners: Record<string, unknown>;
    isDragging: boolean;
  }) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: isDisabled });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : "auto",
    position: isDragging ? "relative" : "static",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && "opacity-80 drop-shadow-md")}
    >
      {children({
        attributes: (attributes ?? {}) as unknown as Record<string, unknown>,
        listeners: (listeners ?? {}) as unknown as Record<string, unknown>,
        isDragging,
      })}
    </div>
  );
}

export function TaskFilesExplorer({
  taskId,
  projectId,
  projectSlug,
  linkedNodes,
  canEdit,
  onUnlink,
  onOpenFile,
  onShowHistory,
  onOpenInWorkspace,
  onReplaceWithNewVersion,
  onReorder,
}: TaskFilesExplorerProps) {
  const { showToast } = useToast();

  // Local optimistic mirror to avoid jank during reorder / annotation edits.
  const [localNodes, setLocalNodes] = useState(linkedNodes);
  const [annotationDrafts, setAnnotationDrafts] = useState<Record<string, string>>({});
  const pendingOptimisticRef = useRef(0);
  const linkedNodesRef = useRef(linkedNodes);

  useEffect(() => {
    linkedNodesRef.current = linkedNodes;
  }, [linkedNodes]);

  const syncLocalNodesFromProps = useCallback(() => {
    if (pendingOptimisticRef.current > 0) return;
    setLocalNodes((prev) =>
      sameLinkedNodesContent(prev, linkedNodesRef.current) ? prev : linkedNodesRef.current,
    );
  }, []);

  useEffect(() => {
    syncLocalNodesFromProps();
  }, [linkedNodes, syncLocalNodesFromProps]);

  // Right-click context menu state — preserved for muscle memory parity
  // with other parts of the app. The overflow menu on the row is the
  // primary surface; this is the secondary one.
  const [contextMenuState, setContextMenuState] = useState<{
    open: boolean;
    x: number;
    y: number;
    node: ProjectNode | null;
  }>({ open: false, x: 0, y: 0, node: null });

  // Files-workspace store selectors (shared with the global explorer).
  const nodesById = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.nodesById || EMPTY_OBJ,
  );
  const childrenByParentId = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.childrenByParentId || EMPTY_OBJ,
  );
  const loadedChildren = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.loadedChildren || EMPTY_OBJ,
  );
  const expandedFolderIds = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.expandedFolderIds || EMPTY_OBJ,
  );

  const upsertNodes = useFilesWorkspaceStore((s) => s.upsertNodes);
  const setChildren = useFilesWorkspaceStore((s) => s.setChildren);
  const markChildrenLoaded = useFilesWorkspaceStore((s) => s.markChildrenLoaded);
  const toggleExpanded = useFilesWorkspaceStore((s) => s.toggleExpanded);

  // Boot — keep linkedNodes in the workspace store so child fetches use
  // the same cache as the global file explorer.
  useEffect(() => {
    upsertNodes(projectId, linkedNodes);
  }, [projectId, linkedNodes, upsertNodes]);

  const loadChildren = useCallback(
    async (parentId: string, opts?: { force?: boolean }) => {
      const key = filesParentKey(parentId);
      const currentWs = useFilesWorkspaceStore.getState().byProjectId[projectId];
      const alreadyLoaded = currentWs?.loadedChildren?.[key];

      if (!opts?.force && alreadyLoaded) return;

      try {
        const res = await getProjectNodes(projectId, parentId);
        const nodes = Array.isArray(res) ? res : res.nodes;
        upsertNodes(projectId, nodes);
        setChildren(
          projectId,
          parentId,
          nodes.map((n) => n.id),
        );
        markChildrenLoaded(projectId, parentId);
      } catch (e) {
        console.error("Failed to load task file children", e);
      }
    },
    [projectId, upsertNodes, setChildren, markChildrenLoaded],
  );

  // Build a flat row list for the virtualized list.
  //
  // Root rows use the node object from `localNodes` directly (source of
  // truth from the task resource), so they render on the very first
  // paint — without this, the legacy `nodesById[id]` lookup returned
  // undefined until the `upsertNodes` useEffect fired, leaving the list
  // empty for one render cycle.
  //
  // Child rows (folder expansion) still go through `nodesById` because
  // they're lazily fetched by `loadChildren` and only live in the store.
  const visibleRows = useMemo<VisibleRow[]>(() => {
    const rows: VisibleRow[] = [];

    const roots = [...localNodes].sort((a, b) => {
      const orderA = a.order ?? 0;
      const orderB = b.order ?? 0;
      if (orderA !== orderB) return orderA - orderB;
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    if (roots.length === 0) return rows;

    const walkChildren = (
      parentId: string,
      parentType: ProjectNode["type"],
      level: number,
    ) => {
      if (parentType !== "folder") return;
      if (!expandedFolderIds[parentId]) return;

      const key = filesParentKey(parentId);
      const childIds = childrenByParentId[key] || [];
      const isLoaded = loadedChildren[key];

      if (!isLoaded) {
        rows.push({ kind: "loading", level });
        return;
      }

      const childNodes = childIds
        .map((id) => nodesById[id])
        .filter(Boolean)
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      for (const child of childNodes) {
        rows.push({
          kind: "node",
          node: { ...child, annotation: null },
          level,
          isRoot: false,
        });
        walkChildren(child.id, child.type, level + 1);
      }
    };

    for (const root of roots) {
      rows.push({
        kind: "node",
        node: root,
        level: 0,
        isRoot: true,
      });
      walkChildren(root.id, root.type, 1);
    }

    return rows;
  }, [localNodes, nodesById, expandedFolderIds, childrenByParentId, loadedChildren]);

  const handleToggle = useCallback(
    (node: ProjectNode) => {
      if (node.type !== "folder") return;
      const next = !expandedFolderIds[node.id];
      toggleExpanded(projectId, node.id, next);
      if (next) void loadChildren(node.id);
    },
    [expandedFolderIds, loadChildren, projectId, toggleExpanded],
  );

  const handleAnnotationChange = useCallback(
    async (nodeId: string, val: string) => {
      const value = val.trim();
      const previousAnnotation = localNodes.find((n) => n.id === nodeId)?.annotation;
      pendingOptimisticRef.current += 1;
      setLocalNodes((prev) =>
        prev.map((n) => (n.id === nodeId ? { ...n, annotation: value || null } : n)),
      );
      try {
        await updateTaskNodeLink(taskId, nodeId, { annotation: value || null });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to save annotation";
        setLocalNodes((prev) =>
          prev.map((n) => (n.id === nodeId ? { ...n, annotation: previousAnnotation } : n)),
        );
        showToast(message, "error");
      } finally {
        pendingOptimisticRef.current = Math.max(0, pendingOptimisticRef.current - 1);
        syncLocalNodesFromProps();
      }
    },
    [localNodes, showToast, syncLocalNodesFromProps, taskId],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = localNodes.findIndex((n) => n.id === active.id);
      const newIndex = localNodes.findIndex((n) => n.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const previousNodes = localNodes;
      pendingOptimisticRef.current += 1;
      const newNodes = arrayMove(localNodes, oldIndex, newIndex).map((n, i) => ({
        ...n,
        order: i,
      }));
      setLocalNodes(newNodes);

      onReorder?.(newNodes.map((n) => n.id));

      try {
        const updates = newNodes.map((n) => ({ nodeId: n.id, order: n.order ?? 0 }));
        await updateTaskNodeLinksOrder(taskId, updates);
      } catch {
        setLocalNodes(previousNodes);
        onReorder?.(previousNodes.map((n) => n.id));
        showToast("Failed to preserve file order", "error");
      } finally {
        pendingOptimisticRef.current = Math.max(0, pendingOptimisticRef.current - 1);
        syncLocalNodesFromProps();
      }
    },
    [localNodes, onReorder, showToast, syncLocalNodesFromProps, taskId],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const renderRow = useCallback(
    (row: VisibleRow) => {
      if (row.kind === "loading") {
        return (
          <div
            className="flex items-center gap-2 py-2 pl-8 text-xs text-zinc-500"
            style={{ paddingLeft: `${16 + row.level * 20}px` }}
          >
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading…
          </div>
        );
      }

      const node = row.node;
      const isExpanded = !!expandedFolderIds[node.id];
      const annotation = row.node.annotation ?? null;
      const isRoot = row.isRoot;
      const indentPx = row.level * 20;

      const renderRowBody = (handle?: {
        attributes: Record<string, unknown>;
        listeners: Record<string, unknown>;
      }) => (
        <div style={{ paddingLeft: indentPx }}>
          <TaskFileRow
            node={{ ...node, annotation }}
            projectId={projectId}
            projectSlug={projectSlug}
            taskId={taskId}
            canEdit={canEdit}
            isExpanded={isExpanded}
            onToggleExpanded={handleToggle}
            dragHandleProps={
              handle && isRoot ? { attributes: handle.attributes, listeners: handle.listeners } : undefined
            }
            onOpen={(n) => {
              if (n.type === "folder") {
                handleToggle(n);
                return;
              }
              onOpenFile?.(n);
            }}
            onShowHistory={(n) => onShowHistory?.(n)}
            onUnlink={(n) => onUnlink?.(n.id)}
            onOpenInWorkspace={onOpenInWorkspace}
            onReplaceWithNewVersion={onReplaceWithNewVersion}
            onContextMenu={(event) => {
              event.preventDefault();
              setContextMenuState({
                open: true,
                x: event.clientX,
                y: event.clientY,
                node,
              });
            }}
          />
          {isRoot ? (
            <div className="mt-1 pl-9 pr-2 pb-1">
              <input
                type="text"
                maxLength={255}
                placeholder="Add a note (e.g. 'Final delivery', 'Reference only')"
                value={annotationDrafts[node.id] ?? annotation ?? ""}
                onChange={(e) => {
                  const nextValue = e.target.value;
                  setAnnotationDrafts((prev) => ({ ...prev, [node.id]: nextValue }));
                }}
                onBlur={(e) => {
                  const nextValue = e.target.value;
                  setAnnotationDrafts((prev) => {
                    const next = { ...prev };
                    delete next[node.id];
                    return next;
                  });
                  if (nextValue.trim() !== (annotation || "").trim()) {
                    void handleAnnotationChange(node.id, nextValue);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                disabled={!canEdit}
                className="w-full rounded bg-transparent px-1 py-0.5 text-xs text-zinc-500 outline-none transition-colors hover:bg-zinc-100 focus:bg-white focus:ring-1 focus:ring-indigo-500 dark:hover:bg-zinc-800 dark:focus:bg-zinc-950"
              />
            </div>
          ) : null}
        </div>
      );

      if (!isRoot) {
        // Children of expanded folders aren't reorderable; render flat.
        return renderRowBody();
      }

      return (
        <SortableRow id={node.id} isDisabled={!canEdit}>
          {(handle) => renderRowBody(handle)}
        </SortableRow>
      );
    },
    [
      annotationDrafts,
      canEdit,
      expandedFolderIds,
      handleAnnotationChange,
      handleToggle,
      onOpenFile,
      onOpenInWorkspace,
      onReplaceWithNewVersion,
      onShowHistory,
      onUnlink,
      projectId,
      projectSlug,
      taskId,
    ],
  );

  return (
    <div className="flex flex-col">
      {/* Drop hint — always visible above a non-empty list so users know
          drag-to-add and drag-to-replace are supported. The full-area
          drop overlay still belongs to the parent FilesTab. */}
      <div
        className="mb-2 flex items-center gap-2 rounded-md border border-dashed border-zinc-200 bg-zinc-50 px-3 py-1.5 text-[11px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400"
        data-testid="task-files-drop-hint"
      >
        <ArrowDownToLine className="h-3 w-3" />
        <span>
          Drag a file here to attach, or drop an edited copy to save it as a
          new version. Folders welcome.
        </span>
      </div>

      {/*
        Plain vertical stack — no virtualization. Task attachments are
        typically 1–20 items; even with every folder expanded the row count
        stays in the low hundreds, well within comfortable DOM rendering.
        The previous Virtuoso-based layout depended on its parent providing
        a concrete pixel height. The Files tab wrapper uses `min-h-[300px]
        flex-1` inside a non-flex parent, so Virtuoso's `height: 100%`
        resolved to zero and rendered nothing — the drop hint above was
        visible (outside the virtualizer) but the actual rows were not.
      */}
      <div className="flex flex-col" data-testid="task-files-list">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={localNodes.map((n) => n.id)}
            strategy={verticalListSortingStrategy}
          >
            {visibleRows.map((row, index) => (
              <div
                key={
                  row.kind === "node"
                    ? `${row.node.id}-${index}`
                    : `loading-${index}`
                }
                className="px-1 py-0.5"
              >
                {renderRow(row)}
              </div>
            ))}
          </SortableContext>
        </DndContext>
      </div>

      {/* Right-click context menu — kept as a parallel surface so users
          who right-click out of habit still find Download / History /
          Unlink. The row's overflow `[⋯]` menu is the primary path. */}
      <DropdownMenu
        open={contextMenuState.open}
        onOpenChange={(open) =>
          setContextMenuState((prev) => ({ ...prev, open }))
        }
      >
        <div
          style={{
            position: "fixed",
            left: contextMenuState.x,
            top: contextMenuState.y,
            width: 1,
            height: 1,
            pointerEvents: "none",
          }}
        />
        <DropdownMenuContent
          align="start"
          className="absolute z-[300] w-52"
          style={{ left: contextMenuState.x, top: contextMenuState.y }}
        >
          {contextMenuState.node && (
            <>
              {onOpenFile && contextMenuState.node.type === "file" && (
                <DropdownMenuItem
                  onClick={() => onOpenFile(contextMenuState.node!)}
                >
                  <ArrowDownToLine className="mr-2 h-4 w-4" />
                  Open / Download
                </DropdownMenuItem>
              )}
              {onShowHistory && contextMenuState.node.type === "file" && (
                <DropdownMenuItem
                  onClick={() => onShowHistory(contextMenuState.node!)}
                >
                  <History className="mr-2 h-4 w-4" />
                  Version history
                </DropdownMenuItem>
              )}
              {onUnlink && canEdit && (
                <DropdownMenuItem
                  onClick={() => onUnlink(contextMenuState.node!.id)}
                  className="text-rose-600 focus:text-rose-600"
                >
                  <LinkIcon className="mr-2 h-4 w-4" />
                  Unlink from task
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
