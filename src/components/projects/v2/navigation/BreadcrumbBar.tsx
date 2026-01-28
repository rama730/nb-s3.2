"use client";

import React, { useEffect, useState } from "react";
import { ProjectNode } from "@/lib/db/schema";
import { getBreadcrumbs, findNodeByPathAny } from "@/app/actions/files";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";

interface BreadcrumbBarProps {
  projectId: string;
  node: ProjectNode | null;
  onCrumbClick: (folderId: string) => void;
  onNavigateNode: (node: ProjectNode) => void;
}

export function BreadcrumbBar({
  projectId,
  node,
  onCrumbClick,
  onNavigateNode,
}: BreadcrumbBarProps) {
  const [crumbs, setCrumbs] = useState<Array<{ id: string; name: string; parentId: string | null }>>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [pathInput, setPathInput] = useState("");

  const childrenByParentId = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.childrenByParentId || {});
  const nodesById = useFilesWorkspaceStore((s) => s.byProjectId[projectId]?.nodesById || {});

  useEffect(() => {
    const folderId = node?.type === "file" ? node.parentId ?? null : node?.id ?? null;
    if (!folderId) {
      setCrumbs([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const data = (await getBreadcrumbs(projectId, folderId)) as any[];
      if (!cancelled) {
        setCrumbs(
          (data || []).map((c) => ({
            id: c.id,
            name: c.name,
            parentId: c.parentId ?? null,
          }))
        );
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, node?.id, node?.parentId, node?.type]);

  const currentPathStr = crumbs.map((c) => c.name).join("/");

  const renderDropdown = (parentId: string | null, currentId: string) => {
    const key = parentId ?? "__root__";
    const childIds = childrenByParentId[key] || [];
    if (childIds.length === 0) return null;

    const siblings = childIds
      .map((id) => nodesById[id])
      .filter((n) => n && n.id !== currentId) // Filter out self? No, keep self but mark active? VS Code keeps self.
      .sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === "folder" ? -1 : 1;
      });

    if (siblings.length === 0) return null;

    return (
      <DropdownMenuContent align="start" className="max-h-[300px] overflow-y-auto">
        {siblings.map((sibling) => (
          <DropdownMenuItem
            key={sibling.id}
            onClick={() => {
              if (sibling.type === "folder") onCrumbClick(sibling.id);
              else onNavigateNode(sibling);
            }}
            className="gap-2"
          >
            {sibling.type === "folder" ? (
               <div className="w-4 h-4 flex items-center justify-center text-blue-400">/</div>
            ) : (
               <div className="w-4 h-4" />
            )}
            <span className="truncate max-w-[200px]">{sibling.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    );
  };

  return (
    <div
      className="flex items-center gap-0.5 text-xs text-zinc-500 dark:text-zinc-400 overflow-x-auto h-7 select-none"
      onDoubleClick={() => {
        setPathInput(currentPathStr);
        setIsEditing(true);
      }}
      title="Double-click to type a path"
    >
      <Home 
        className="w-3.5 h-3.5 flex-shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 cursor-pointer mr-1" 
        onClick={() => onCrumbClick(node?.projectId ? "" : "")} // How to go to root? onCrumbClick with null? ProjectFilesWorkspace handles empty?
        // Actually onCrumbClick expects folderId. Root folder ID? 
        // We'll leave Home as just an icon for now or trigger 'root' navigation if we had a root ID.
      />
      
      {isEditing ? (
        <input
          className="h-5 px-1 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100 outline-none w-full max-w-sm"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          autoFocus
          onBlur={() => setIsEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setIsEditing(false);
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              const parts = pathInput
                .split("/")
                .map((p) => p.trim())
                .filter(Boolean);
              void (async () => {
                const found = (await findNodeByPathAny(projectId, parts)) as ProjectNode | null;
                if (found) {
                  if (found.type === "folder") onCrumbClick(found.id);
                  else onNavigateNode(found);
                }
                setIsEditing(false);
              })();
            }
          }}
        />
      ) : crumbs.length === 0 ? (
        <span className="text-zinc-400 italic px-1">/</span>
      ) : (
        crumbs.map((c, idx) => (
          <div key={c.id} className="flex items-center">
            {idx > 0 && <ChevronRight className="w-3 h-3 flex-shrink-0 text-zinc-300 dark:text-zinc-600 mx-0.5" />}
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="hover:bg-zinc-100 dark:hover:bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-700 dark:text-zinc-200 transition-colors truncate max-w-[120px]"
                  onClick={(e) => {
                    e.stopPropagation(); // Don't trigger dropdown immediately? 
                    // Actually VS Code triggers dropdown on click of text. 
                    // But we also want to navigate to it. 
                    // Double click maps to everything. 
                    // Let's say click navigates to that folder.
                    // If you want dropdown, maybe right click? Or a small chevron next to it?
                    // VS Code: Click on name -> Focus that part of breadcrumb? No, it shows dropdown.
                    // If I click 'src', it shows contents of 'src'. Yes.
                    // BUT it also navigates to it in explorer? 
                    // Let's stick to: Click = Navigate (onCrumbClick).
                    // We add a chevron for dropdown? Or simplify: Click = Navigate.
                    // USER REQUEST: "Clicking a folder segment ... opens a dropdown listing its siblings."
                    // OK, so Click = Dropdown.
                  }}
                >
                  {c.name}
                </button>
              </DropdownMenuTrigger>
              {renderDropdown(c.parentId, c.id)}
            </DropdownMenu>
          </div>
        ))
      )}
      
      {/* Show file name if it's a file node */}
      {node && node.type === "file" && (
         <div className="flex items-center">
             <ChevronRight className="w-3 h-3 flex-shrink-0 text-zinc-300 dark:text-zinc-600 mx-0.5" />
             <span className="font-semibold text-zinc-900 dark:text-zinc-100 px-1.5 py-0.5">
                 {node.name}
             </span>
         </div>
      )}
    </div>
  );
}
