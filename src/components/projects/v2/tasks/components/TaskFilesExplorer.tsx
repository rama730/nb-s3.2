"use client";

import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { Virtuoso } from "react-virtuoso";
import { Loader2, Plus, Upload, Link as LinkIcon, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui-custom/Toast";
import type { ProjectNode } from "@/lib/db/schema";
import { getProjectNodes, getTaskLinkCounts } from "@/app/actions/files";
import { FileTreeRow } from "@/components/projects/v2/explorer/FileTreeRow";
import { useFilesWorkspaceStore, filesParentKey } from "@/stores/filesWorkspaceStore";
import { FileIcon } from "@/components/projects/v2/explorer/FileIcons";
import { updateTaskNodeLink, updateTaskNodeLinksOrder } from "@/app/actions/files/links";
import { getProjectFileSignedUrl } from "@/app/actions/files/content";
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from "lucide-react";

const EMPTY_OBJ = {};

function formatBytes(bytes?: number | null) {
    const b = bytes ?? 0;
    if (b < 1024) return `${b} B`;
    const kb = b / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
}

function PreviewTooltip({ node, children, projectId }: { node: ProjectNode, children: React.ReactNode, projectId: string }) {
    const isImage = node.name.match(/\.(jpeg|jpg|gif|png|webp|svg)$/i);
    const [url, setUrl] = useState<string | null>(null);
    const [fileUrlError, setFileUrlError] = useState<string | null>(null);
    const isMountedRef = useRef(true);
    const activePreviewRequestRef = useRef(0);

    useEffect(() => {
        activePreviewRequestRef.current += 1;
        setUrl(null);
        setFileUrlError(null);
    }, [node.id, projectId]);

    useEffect(() => {
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    return (
        <Tooltip delayDuration={600} onOpenChange={(open) => {
            const shouldFetchPreview = open && !!isImage && !url && !!node.s3Key;
            if (!shouldFetchPreview) return;

            const requestId = ++activePreviewRequestRef.current;
            const fetchPreviewUrl = async () => {
                try {
                    setFileUrlError(null);
                    const res = await getProjectFileSignedUrl(projectId, node.s3Key!);
                    if (!isMountedRef.current || activePreviewRequestRef.current !== requestId) return;
                    setUrl(res.url);
                } catch (error) {
                    if (!isMountedRef.current || activePreviewRequestRef.current !== requestId) return;
                    setUrl(null);
                    setFileUrlError(error instanceof Error ? error.message : "Preview unavailable");
                    console.error("Failed to load preview signed URL", error);
                }
            };

            void fetchPreviewUrl();
        }}>
            <TooltipTrigger asChild>
                {children}
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-xs shadow-xl z-[100] border-zinc-200 dark:border-zinc-800">
                <div className="flex flex-col gap-1 w-full">
                    <span className="font-semibold text-xs truncate max-w-[200px]">{node.name}</span>
                    <span className="text-[10px] text-zinc-500">{formatBytes(node.size)}</span>
                    {isImage && (
                        fileUrlError ? (
                            <div className="mt-2 w-[200px] h-24 flex items-center justify-center bg-zinc-100 dark:bg-zinc-800 rounded text-[11px] text-zinc-500 text-center px-3">
                                Preview unavailable
                            </div>
                        ) : url ? (
                            <img src={url} alt={node.name} className="mt-2 rounded max-w-[200px] max-h-32 object-contain bg-zinc-50 dark:bg-zinc-900 border border-transparent dark:border-zinc-800" />
                        ) : (
                            <div className="mt-2 w-[200px] h-24 flex items-center justify-center bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse">
                                <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
                            </div>
                        )
                    )}
                </div>
            </TooltipContent>
        </Tooltip>
    );
}

function SortableRowWrapper({ id, children, isDisabled }: { id: string; children: (isDragging: boolean) => React.ReactNode; isDisabled?: boolean }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id, disabled: isDisabled });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : "auto",
        position: isDragging ? "relative" as const : "static" as const,
    };

    return (
        <div ref={setNodeRef} style={style} className={cn("group flex relative", isDragging && "opacity-80 drop-shadow-md")}>
            <div 
                {...attributes} 
                {...listeners} 
                className={cn(
                    "cursor-grab active:cursor-grabbing p-1 flex items-center justify-center text-zinc-300 hover:text-zinc-500 dark:text-zinc-700 dark:hover:text-zinc-500",
                    isDisabled ? "invisible" : ""
                )}
            >
                <GripVertical className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0 flex flex-col">
                {children(isDragging)}
            </div>
        </div>
    );
}

interface TaskFilesExplorerProps {
    taskId: string;
    projectId: string;
    linkedNodes: (ProjectNode & { order?: number; annotation?: string | null })[];
    canEdit: boolean;
    onUnlink?: (nodeId: string) => void;
    onOpenFile?: (node: ProjectNode) => void;
    onReorder?: (newOrder: string[]) => void;
}

type VisibleRow =
    | { kind: "node"; nodeId: string; level: number; indentationGuides: boolean[]; annotation?: string | null }
    | { kind: "loading"; level: number; indentationGuides: boolean[] }
    | { kind: "empty" };

function sameLinkedNodesContent(
    a: (ProjectNode & { order?: number; annotation?: string | null })[],
    b: (ProjectNode & { order?: number; annotation?: string | null })[],
) {
    return JSON.stringify(a) === JSON.stringify(b);
}

export function TaskFilesExplorer({
    taskId,
    projectId,
    linkedNodes,
    canEdit,
    onUnlink,
    onOpenFile,
    onReorder
}: TaskFilesExplorerProps) {
    const { showToast } = useToast();
    
    // Manage local optimistic ordering and annotations to prevent jank
    const [localNodes, setLocalNodes] = useState(linkedNodes);
    const [annotationDrafts, setAnnotationDrafts] = useState<Record<string, string>>({});
    const pendingOptimisticRef = useRef(0);
    const linkedNodesRef = useRef(linkedNodes);

    useEffect(() => {
        linkedNodesRef.current = linkedNodes;
    }, [linkedNodes]);

    const syncLocalNodesFromProps = useCallback(() => {
        if (pendingOptimisticRef.current > 0) return;
        setLocalNodes((prev) => (sameLinkedNodesContent(prev, linkedNodesRef.current) ? prev : linkedNodesRef.current));
    }, []);

    useEffect(() => {
        syncLocalNodesFromProps();
    }, [linkedNodes, syncLocalNodesFromProps]);
    
    // --- Context Menu State ---
    const [contextMenuState, setContextMenuState] = useState<{
        open: boolean;
        x: number;
        y: number;
        node: ProjectNode | null;
    }>({ open: false, x: 0, y: 0, node: null });

    // Selectors
    const nodesById = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.nodesById || EMPTY_OBJ);
    const childrenByParentId = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.childrenByParentId || EMPTY_OBJ);
    const loadedChildren = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.loadedChildren || EMPTY_OBJ);
    const expandedFolderIds = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.expandedFolderIds || EMPTY_OBJ);
    
    // Actions
    const upsertNodes = useFilesWorkspaceStore((s) => s.upsertNodes);
    const setChildren = useFilesWorkspaceStore((s) => s.setChildren);
    const markChildrenLoaded = useFilesWorkspaceStore((s) => s.markChildrenLoaded);
    const toggleExpanded = useFilesWorkspaceStore((s) => s.toggleExpanded);
    const setSelectedNode = useFilesWorkspaceStore((s) => s.setSelectedNode);

    // Boot - ensure linkedNodes are in the store
    useEffect(() => {
        upsertNodes(projectId, linkedNodes);
    }, [projectId, linkedNodes, upsertNodes]);

    const loadChildren = useCallback(async (parentId: string, opts?: { force?: boolean }) => {
        const key = filesParentKey(parentId);
        const currentWs = useFilesWorkspaceStore.getState().byProjectId[projectId];
        const alreadyLoaded = currentWs?.loadedChildren?.[key];
        
        if (!opts?.force && alreadyLoaded) return;
        
        try {
            const res = await getProjectNodes(projectId, parentId);
            const nodes = Array.isArray(res) ? res : res.nodes;
            upsertNodes(projectId, nodes);
            setChildren(projectId, parentId, nodes.map(n => n.id));
            markChildrenLoaded(projectId, parentId);
        } catch (e) {
            console.error("Failed to load task file children", e);
        }
    }, [projectId, upsertNodes, setChildren, markChildrenLoaded]);

    // Build visible rows based on "Roots" = linkedNodes
    const visibleRows = useMemo(() => {
        const rows: VisibleRow[] = [];
        
        // Use localNodes to respect optimistic sort order
        const roots = [...localNodes].sort((a, b) => {
            const orderA = a.order ?? 0;
            const orderB = b.order ?? 0;
            if (orderA !== orderB) return orderA - orderB;
            if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        if (roots.length === 0) return [{ kind: "empty" }] as VisibleRow[];

        const walk = (nodeId: string, level: number, ancestors: boolean[], annotation?: string | null) => {
            const node = nodesById[nodeId];
            if (!node) return; // Should be in store

            rows.push({ kind: "node", nodeId, level, indentationGuides: ancestors, annotation });

            if (node.type === "folder" && expandedFolderIds[nodeId]) {
                 const key = filesParentKey(nodeId);
                 const childIds = childrenByParentId[key] || [];
                 const isLoaded = loadedChildren[key];

                 const childNodes = childIds.map(id => nodesById[id]).filter(Boolean);
                 childNodes.sort((a, b) => {
                     if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
                     return a.name.localeCompare(b.name);
                 });

                 const nextAncestors = [...ancestors, true];

                 if (!isLoaded) {
                     rows.push({ kind: "loading", level: level + 1, indentationGuides: [...ancestors, false] });
                 } else {
                     for (let i = 0; i < childNodes.length; i++) {
                         const child = childNodes[i];
                         const isLast = i === childNodes.length - 1;
                         // Children don't have task-specific annotations
                         walk(child.id, level + 1, [...ancestors, !isLast], null);
                     }
                 }
            }
        };

        for (let i = 0; i < roots.length; i++) {
            const root = roots[i];
            walk(root.id, 0, [], root.annotation); 
        }

        return rows;
    }, [localNodes, nodesById, expandedFolderIds, childrenByParentId, loadedChildren]);

    const handleToggle = (node: ProjectNode) => {
        if (node.type !== "folder") return;
        const next = !expandedFolderIds[node.id];
        toggleExpanded(projectId, node.id, next);
        if (next) void loadChildren(node.id);
    };

    const handleAnnotationChange = async (nodeId: string, val: string) => {
        const value = val.trim();
        const previousAnnotation = localNodes.find((n) => n.id === nodeId)?.annotation;
        pendingOptimisticRef.current += 1;
        setLocalNodes(prev => prev.map(n => n.id === nodeId ? { ...n, annotation: value || null } : n));
        try {
            await updateTaskNodeLink(taskId, nodeId, { annotation: value || null });
        } catch (e: any) {
            setLocalNodes((prev) =>
                prev.map((n) => (n.id === nodeId ? { ...n, annotation: previousAnnotation } : n))
            );
            showToast(e.message || "Failed to save annotation", "error");
        } finally {
            pendingOptimisticRef.current = Math.max(0, pendingOptimisticRef.current - 1);
            syncLocalNodesFromProps();
        }
    };

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        const oldIndex = localNodes.findIndex(n => n.id === active.id);
        const newIndex = localNodes.findIndex(n => n.id === over.id);

        if (oldIndex !== -1 && newIndex !== -1) {
            const previousNodes = localNodes;
            pendingOptimisticRef.current += 1;
            const newNodes = arrayMove(localNodes, oldIndex, newIndex).map((n, i) => ({ ...n, order: i }));
            setLocalNodes(newNodes);
            
            if (onReorder) {
                onReorder(newNodes.map(n => n.id));
            }

            try {
                // Batch update the dragged nodes order in a single request
                const updates = newNodes.map(n => ({ nodeId: n.id, order: n.order ?? 0 }));
                await updateTaskNodeLinksOrder(taskId, updates);
            } catch (e: any) {
                setLocalNodes(previousNodes);
                if (onReorder) {
                    onReorder(previousNodes.map(n => n.id));
                }
                showToast("Failed to preserve file order", "error");
            } finally {
                pendingOptimisticRef.current = Math.max(0, pendingOptimisticRef.current - 1);
                syncLocalNodesFromProps();
            }
        }
    };

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const rowRenderer = (row: VisibleRow) => {
        if (row.kind === "empty") {
            return (
                <div className="flex flex-col items-center justify-center p-8 text-zinc-500 text-sm">
                    <p>No files linked to this task.</p>
                </div>
            );
        }
        
        if (row.kind === "loading") {
             const guides = row.indentationGuides.map((active, i) => (
                <div key={i} className={cn("w-4 h-full flex-shrink-0 border-l", active ? "border-zinc-200 dark:border-zinc-800" : "border-transparent")} />
            ));
            return (
                <div className="flex items-center h-[22px]">
                    {guides}
                    <div className="w-4 h-full" />
                    <Loader2 className="w-3 h-3 text-zinc-400 animate-spin ml-2" />
                </div>
            );
        }

        const node = nodesById[row.nodeId];
        if (!node) return null;

        const isSelected = false; // For now
        const isExpanded = !!expandedFolderIds[node.id];

        // Wraps the FileTreeRow in a Dnd Sortable element to attach the drag handle overlay
        const isRoot = row.level === 0;

        const renderInner = (
            <FileTreeRow
                node={node}
                indentationGuides={row.indentationGuides}
                isSelected={isSelected}
                isExpanded={isExpanded}
                canEdit={canEdit}
                onToggle={() => handleToggle(node)}
                onSelect={() => {
                    if (node.type === "folder") {
                        handleToggle(node);
                        return;
                    }
                    onOpenFile?.(node);
                }}
                onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenuState({ open: true, x: e.clientX, y: e.clientY, node });
                }}
                onDragStart={() => {}}
                onDragEnd={() => {}}
                onDrop={() => {}}
            />
        );
        
        return (
            <SortableRowWrapper 
                key={node.id}
                id={node.id}
                isDisabled={!isRoot || !canEdit}
            >
                {(isDragging) => (
                    <>
                        {isRoot && node.type === "file" && !isDragging ? (
                            <PreviewTooltip node={node} projectId={projectId}>
                                <div>{renderInner}</div>
                            </PreviewTooltip>
                        ) : (
                            renderInner
                        )}
                        {/* 4c. Inline Annotation Input (only for roots) */}
                        {isRoot && (
                            <div className="pl-6 pr-2 pb-1" onPointerDown={(e) => e.stopPropagation()}>
                                <input
                                    type="text"
                                    maxLength={255}
                                    placeholder="Add reference note..."
                                    value={annotationDrafts[node.id] ?? (row.annotation || "")}
                                    onChange={(e) => {
                                        const nextValue = e.target.value;
                                        setAnnotationDrafts(prev => ({ ...prev, [node.id]: nextValue }));
                                    }}
                                    onBlur={(e) => {
                                        const nextValue = e.target.value;
                                        setAnnotationDrafts(prev => {
                                            const next = { ...prev };
                                            delete next[node.id];
                                            return next;
                                        });
                                        if (nextValue.trim() !== (row.annotation || "").trim()) {
                                            void handleAnnotationChange(node.id, nextValue);
                                        }
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.currentTarget.blur();
                                        }
                                    }}
                                    disabled={!canEdit}
                                    className="w-full text-xs bg-transparent text-zinc-500 border-none px-1 py-0.5 mt-[-4px] mb-1 hover:bg-zinc-100 focus:bg-white dark:hover:bg-zinc-800 dark:focus:bg-zinc-950 focus:ring-1 focus:ring-indigo-500 rounded outline-none transition-colors"
                                />
                            </div>
                        )}
                    </>
                )}
            </SortableRowWrapper>
        );
    };

    return (
        <div className="h-full flex flex-col bg-white dark:bg-zinc-900 border rounded-md overflow-hidden">
             <div className="p-2 border-b bg-zinc-50 dark:bg-zinc-900/50 text-xs font-semibold text-zinc-500 flex justify-between items-center">
                 <span>Linked Files ({linkedNodes.length})</span>
                 {/* Provide slots for "Add Link" button */}
             </div>
             
             <TooltipProvider>
                 <div className="flex-1 min-h-0 relative">
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                        <SortableContext items={localNodes.map(n => n.id)} strategy={verticalListSortingStrategy}>
                            <Virtuoso
                                data={visibleRows}
                                itemContent={(_, row) => <div className="px-2">{rowRenderer(row)}</div>}
                                style={{ height: "100%" }}
                            />
                        </SortableContext>
                    </DndContext>
                 </div>
             </TooltipProvider>

             <DropdownMenu
                 open={contextMenuState.open}
                 onOpenChange={(open) => setContextMenuState(prev => ({ ...prev, open }))}
             >
                 <div style={{ position: "fixed", left: contextMenuState.x, top: contextMenuState.y, width: 1, height: 1, pointerEvents: "none" }} />
                 <DropdownMenuContent align="start" className="w-48 absolute z-50" style={{ left: contextMenuState.x, top: contextMenuState.y }}>
                     {contextMenuState.node && (
                         <>
                             {onOpenFile && contextMenuState.node.type === "file" && (
                                 <DropdownMenuItem onClick={() => onOpenFile(contextMenuState.node!)}>
                                     <ExternalLink className="w-4 h-4 mr-2" />
                                     Open / Download
                                 </DropdownMenuItem>
                             )}
                             {onUnlink && canEdit && (
                                 <DropdownMenuItem onClick={() => onUnlink(contextMenuState.node!.id)} className="text-rose-600 focus:text-rose-600">
                                     <LinkIcon className="w-4 h-4 mr-2" />
                                     Unlink from Task
                                 </DropdownMenuItem>
                             )}
                         </>
                     )}
                 </DropdownMenuContent>
             </DropdownMenu>
        </div>
    );
}
