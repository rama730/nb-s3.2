"use client";

import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { Virtuoso } from "react-virtuoso";
import { Loader2, Plus, Upload, Link as LinkIcon, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui-custom/Toast";
import type { ProjectNode } from "@/lib/db/schema";
import { getProjectNodes, getTaskLinkCounts } from "@/app/actions/files";
import { FileTreeRow } from "@/components/projects/v2/explorer/FileTreeRow";
import { useFilesWorkspaceStore, filesParentKey } from "@/stores/filesWorkspaceStore";
import { FileIcon } from "@/components/projects/v2/explorer/FileIcons";

interface TaskFilesExplorerProps {
    projectId: string;
    linkedNodes: ProjectNode[];
    canEdit: boolean;
    onUnlink?: (nodeId: string) => void;
    onOpenFile?: (node: ProjectNode) => void;
}

type VisibleRow =
    | { kind: "node"; nodeId: string; level: number; indentationGuides: boolean[] }
    | { kind: "loading"; level: number; indentationGuides: boolean[] }
    | { kind: "empty" };

export function TaskFilesExplorer({
    projectId,
    linkedNodes,
    canEdit,
    onUnlink,
    onOpenFile
}: TaskFilesExplorerProps) {
    // We use a "virtual" workspace key to avoid colliding with the main explorer
    // But actually, we can re-use the Store for expanding folders, 
    // provided we key the expansion state correctly.
    // However, the `FileExplorer` uses `useFilesWorkspaceStore` which is singleton-ish per project.
    // If we share the store, expanding "src" in Task will expand "src" in Main Explorer.
    // *This is actually a FEATURE*, not a bug. "One File System".
    
    // So we will reuse the store!

    const { showToast } = useToast();
    
    // Selectors
    const nodesById = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.nodesById || {});
    const childrenByParentId = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.childrenByParentId || {});
    const loadedChildren = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.loadedChildren || {});
    const expandedFolderIds = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.expandedFolderIds || {});
    
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
        
        // Sort linked nodes (folders first, then name)
        const roots = [...linkedNodes].sort((a, b) => {
            if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        if (roots.length === 0) return [{ kind: "empty" }] as VisibleRow[];

        const walk = (nodeId: string, level: number, ancestors: boolean[]) => {
            const node = nodesById[nodeId];
            if (!node) return; // Should be in store

            rows.push({ kind: "node", nodeId, level, indentationGuides: ancestors });

            if (node.type === "folder" && expandedFolderIds[nodeId]) {
                 const key = filesParentKey(nodeId);
                 const childIds = childrenByParentId[key] || [];
                 const isLoaded = loadedChildren[key];

                 // Sort children
                 const childNodes = childIds.map(id => nodesById[id]).filter(Boolean);
                 childNodes.sort((a, b) => {
                     if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
                     return a.name.localeCompare(b.name);
                 });

                 const nextAncestors = [...ancestors, true]; // Always draw line for children of these virtual roots? 
                 // Actually, standard logic:
                 // If I am NOT the last child of my parent, I pass "true" (draw line).
                 // For the ROOTS, they are siblings.
                 // But wait, the `ancestors` array tracks whether *parent levels* have subsequent siblings.
                 // For the roots, we treat them as level 0.

                 if (!isLoaded) {
                     rows.push({ kind: "loading", level: level + 1, indentationGuides: [...ancestors, false] }); // simplify guides for now
                 } else {
                     for (let i = 0; i < childNodes.length; i++) {
                         const child = childNodes[i];
                         const isLast = i === childNodes.length - 1;
                         // If parent (nodeId) is last in its list, passes false?
                         // The `ancestors` passed to this `walk` come from the parent.
                         // But we need to verify the guides logic.
                         // For now, let's just recurse.
                         walk(child.id, level + 1, [...ancestors, !isLast]);
                     }
                 }
            }
        };

        for (let i = 0; i < roots.length; i++) {
            const root = roots[i];
            const isLast = i === roots.length - 1;
            // Level 0 gets empty ancestors? Or maybe we want to show them as a list?
            walk(root.id, 0, []); 
        }

        return rows;
    }, [linkedNodes, nodesById, expandedFolderIds, childrenByParentId, loadedChildren]);

    const handleToggle = (node: ProjectNode) => {
        if (node.type !== "folder") return;
        const next = !expandedFolderIds[node.id];
        toggleExpanded(projectId, node.id, next);
        if (next) void loadChildren(node.id);
    };

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

        // Custom context menu for Unlink?
        // Reuse FileTreeRow but maybe inject actions?
        return (
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
                }}
                onDragStart={() => {}}
                onDragEnd={() => {}}
                onDrop={() => {}}
                
                menu={
                    <>
                        {onOpenFile && node.type === "file" && (
                            <DropdownMenuItem onClick={() => onOpenFile(node)}>
                                <ExternalLink className="w-4 h-4 mr-2" />
                                Open / Download
                            </DropdownMenuItem>
                        )}
                        {onUnlink && canEdit && (
                            <DropdownMenuItem onClick={() => onUnlink(node.id)} className="text-rose-600 focus:text-rose-600">
                                <LinkIcon className="w-4 h-4 mr-2" />
                                Unlink from Task
                            </DropdownMenuItem>
                        )}
                    </>
                }
            />
        );
    };

    return (
        <div className="h-full flex flex-col bg-white dark:bg-zinc-900 border rounded-md overflow-hidden">
             <div className="p-2 border-b bg-zinc-50 dark:bg-zinc-900/50 text-xs font-semibold text-zinc-500 flex justify-between items-center">
                 <span>Linked Files ({linkedNodes.length})</span>
                 {/* Provide slots for "Add Link" button */}
             </div>
             
             <div className="flex-1 min-h-0">
                <Virtuoso
                    data={visibleRows}
                    itemContent={(_, row) => <div className="px-2">{rowRenderer(row)}</div>}
                    style={{ height: "100%" }}
                />
             </div>
        </div>
    );
}
