"use client";

import React, { useState, useEffect, useCallback, memo } from "react";
import { getProjectNodes } from "@/app/actions/files";
import { 
    Folder, 
    FolderOpen, 
    FileText, 
    ChevronRight, 
    ChevronDown,
    Check
} from "lucide-react";
import { ProjectNode } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

interface FileTreePickerProps {
    projectId: string;
    projectName?: string;
    onFileSelect: (node: ProjectNode) => void;
    selectedFileId?: string;
}

/**
 * Optimized Tree View File Picker
 * - Lazy loading (fetch children on expand)
 * - Zero duplication (single recursive component)
 * - Clean hierarchy display
 * - Always shows project root
 */
export default function FileTreePicker({ 
    projectId, 
    projectName = "Project Files", 
    onFileSelect,
    selectedFileId 
}: FileTreePickerProps) {
    const [rootNodes, setRootNodes] = useState<ProjectNode[]>([]);
    const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
    const [loadedNodes, setLoadedNodes] = useState<Map<string, ProjectNode[]>>(new Map());
    const [isLoading, setIsLoading] = useState(true);

    // Initial load
    useEffect(() => {
        loadRootNodes();
    }, [projectId]);

    const loadRootNodes = async () => {
        setIsLoading(true);
        try {
            const res = await getProjectNodes(projectId, null);
            const nodes = Array.isArray(res) ? res : res.nodes;
            setRootNodes(nodes);
            
            // Auto-expand root folder if only one exists
            if (nodes.length === 1 && nodes[0].type === 'folder') {
                const rootId = nodes[0].id;
                setExpandedNodes(new Set([rootId]));
                const res = await getProjectNodes(projectId, rootId);
                const children = Array.isArray(res) ? res : res.nodes;
                setLoadedNodes(new Map([[rootId, children]]));
            }
        } catch (error) {
            console.error("Failed to load files:", error);
        } finally {
            setIsLoading(false);
        }
    };

    // Lazy load children
    const handleToggle = useCallback(async (node: ProjectNode) => {
        if (node.type !== 'folder') return;

        const nodeId = node.id;
        const isExpanded = expandedNodes.has(nodeId);

        if (isExpanded) {
            // Collapse
            setExpandedNodes(prev => {
                const next = new Set(prev);
                next.delete(nodeId);
                return next;
            });
        } else {
            // Expand - load if not cached
            if (!loadedNodes.has(nodeId)) {
                const res = await getProjectNodes(projectId, nodeId);
                const children = Array.isArray(res) ? res : res.nodes;
                setLoadedNodes(prev => new Map(prev).set(nodeId, children));
            }
            setExpandedNodes(prev => new Set(prev).add(nodeId));
        }
    }, [projectId, expandedNodes, loadedNodes]);

    if (isLoading) {
        return (
            <div className="p-8 flex items-center justify-center">
                <div className="text-sm text-zinc-500">Loading files...</div>
            </div>
        );
    }

    // Always show project root, even if empty
    return (
        <div className="p-4">
            <div className="space-y-0.5">
                {rootNodes.length === 0 ? (
                    // Show project root as empty folder
                    <div className="p-8 text-center">
                        <Folder className="w-16 h-16 text-blue-500/20 mx-auto mb-4" />
                        <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
                            {projectName}
                        </p>
                        <p className="text-sm text-zinc-500">
                            No files in project yet
                        </p>
                        <p className="text-xs text-zinc-400 mt-2">
                            Upload files to the Files tab first
                        </p>
                    </div>
                ) : (
                    rootNodes.map((node) => (
                        <TreePickerNode
                            key={node.id}
                            node={node}
                            level={0}
                            isExpanded={expandedNodes.has(node.id)}
                            childNodes={loadedNodes.get(node.id)}
                            onToggle={handleToggle}
                            onFileSelect={onFileSelect}
                            selectedFileId={selectedFileId}
                        />
                    ))
                )}
            </div>
        </div>
    );
}

// Memoized Tree Node for Picker
interface TreePickerNodeProps {
    node: ProjectNode;
    level: number;
    isExpanded: boolean;
    childNodes?: ProjectNode[];
    onToggle: (node: ProjectNode) => void;
    onFileSelect: (node: ProjectNode) => void;
    selectedFileId?: string;
}

const TreePickerNode = memo(function TreePickerNode({
    node,
    level,
    isExpanded,
    childNodes,
    onToggle,
    onFileSelect,
    selectedFileId
}: TreePickerNodeProps) {
    const isFolder = node.type === 'folder';
    const isSelected = selectedFileId === node.id;

    const handleClick = () => {
        if (isFolder) {
            onToggle(node);
        } else {
            onFileSelect(node);
        }
    };

    return (
        <div>
            {/* Node Row */}
            <div
                onClick={handleClick}
                className={cn(
                    "group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer transition-colors relative",
                    isSelected 
                        ? "bg-blue-50 dark:bg-blue-900/20" 
                        : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                )}
                style={{ paddingLeft: `${level * 20 + 8}px` }}
            >
                {/* Thread line */}
                {level > 0 && (
                    <div 
                        className="absolute left-0 top-0 bottom-0 w-px bg-zinc-200 dark:bg-zinc-700"
                        style={{ left: `${(level - 1) * 20 + 18}px` }}
                    />
                )}

                {/* Chevron or Spacer */}
                {isFolder ? (
                    <div className="flex items-center justify-center w-4 h-4 flex-shrink-0">
                        {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
                        ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
                        )}
                    </div>
                ) : (
                    <div className="w-4" />
                )}

                {/* Icon */}
                <div className="flex-shrink-0">
                    {isFolder ? (
                        isExpanded ? (
                            <FolderOpen className="w-4 h-4 text-blue-500" />
                        ) : (
                            <Folder className="w-4 h-4 text-blue-500" />
                        )
                    ) : (
                        <FileText className={cn(
                            "w-4 h-4",
                            isSelected ? "text-blue-600" : "text-zinc-400"
                        )} />
                    )}
                </div>

                {/* Name */}
                <span className={cn(
                    "flex-1 text-sm font-medium truncate",
                    isSelected 
                        ? "text-blue-700 dark:text-blue-300" 
                        : "text-zinc-700 dark:text-zinc-200"
                )}>
                    {node.name}
                </span>

                {/* Selected Checkmark */}
                {isSelected && (
                    <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                )}
            </div>

            {/* Children (Recursive) */}
            {isFolder && isExpanded && childNodes && (
                <div>
                    {childNodes.map((child) => (
                        <TreePickerNode
                            key={child.id}
                            node={child}
                            level={level + 1}
                            isExpanded={false} // Controlled by parent
                            onToggle={onToggle}
                            onFileSelect={onFileSelect}
                            selectedFileId={selectedFileId}
                        />
                    ))}
                </div>
            )}
        </div>
    );
});
