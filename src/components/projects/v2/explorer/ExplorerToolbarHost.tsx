"use client";

import React from "react";
import {
  Clock,
  List,
  MoreHorizontal,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { FilesViewMode } from "@/stores/filesWorkspaceStore";

interface ExplorerToolbarHostProps {
  canEdit: boolean;
  viewMode: FilesViewMode;
  explorerMode: string;
  searchQuery: string;
  inlineSearchOpen: boolean;
  isSearching: boolean;
  operationsOpen: boolean;
  isInsightsOpen: boolean;
  uploadEnabled: boolean;
  selectedNode: { id: string; type: "file" | "folder"; parentId?: string | null } | null;
  selectedFolderId?: string | null;
  savedViews: Array<{ id: string; name: string }>;
  selectedSavedViewId: string;
  onSetViewMode: (mode: FilesViewMode) => void;
  onSetExplorerMode: (
    mode: "tree" | "favorites" | "recents" | "trash" | "sourceControl" | "outline"
  ) => void;
  onToggleInlineSearch: () => void;
  onSearchQueryChange: (value: string) => void;
  onSortChange: (value: "name" | "updated" | "type") => void;
  sort: "name" | "updated" | "type";
  onToggleOperationsOpen: () => void;
  onToggleInsightsOpen: () => void;
  onSaveCurrentView: () => void;
  onApplySavedView: (viewId: string) => void;
  onDeleteSavedView: () => void;
  onOpenCreateFolder: () => void;
  onOpenCreateFile: () => void;
  onUpload: (parentId: string | null) => void;
  onUploadFolder: (parentId: string | null) => void;
}

// FW10: Memoize to prevent re-renders when unrelated ExplorerShell state changes
export const ExplorerToolbarHost = React.memo(function ExplorerToolbarHost({
  canEdit,
  viewMode,
  explorerMode,
  searchQuery,
  inlineSearchOpen,
  isSearching,
  operationsOpen,
  isInsightsOpen,
  uploadEnabled,
  selectedNode,
  selectedFolderId,
  savedViews,
  selectedSavedViewId,
  onSetViewMode,
  onSetExplorerMode,
  onToggleInlineSearch,
  onSearchQueryChange,
  onSortChange,
  sort,
  onToggleOperationsOpen,
  onToggleInsightsOpen,
  onSaveCurrentView,
  onApplySavedView,
  onDeleteSavedView,
  onOpenCreateFolder,
  onOpenCreateFile,
  onUpload,
  onUploadFolder,
}: ExplorerToolbarHostProps) {
  return (
    <>
      <div className="flex items-center justify-between gap-2 p-2 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2 min-w-0">
          <select
            data-testid="files-explorer-view-mode"
            className="h-7 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs font-medium px-2 focus:ring-2 focus:ring-indigo-500/20 outline-none cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            value={viewMode}
            onChange={(e) => onSetViewMode(e.target.value as FilesViewMode)}
            title="View mode"
          >
            <option value="code">Code</option>
            <option value="assets">Assets</option>
            <option value="all">All Files</option>
          </select>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                data-testid="files-explorer-actions-trigger"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                title="File actions"
              >
                Actions
                <MoreHorizontal className="w-3.5 h-3.5 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  onToggleOperationsOpen();
                }}
              >
                {operationsOpen ? "Hide operations center" : "Show operations center"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  onToggleInsightsOpen();
                }}
              >
                {isInsightsOpen ? "Hide insights" : "Show insights"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  onSetExplorerMode("sourceControl");
                }}
              >
                {explorerMode === "sourceControl" ? "✓ " : ""}Source Control
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  onSetExplorerMode("outline");
                }}
              >
                {explorerMode === "outline" ? "✓ " : ""}Outline
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onSortChange("name"); }}>
                {sort === "name" ? "✓ " : ""}Sort by Name
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onSortChange("updated"); }}>
                {sort === "updated" ? "✓ " : ""}Sort by Updated
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onSortChange("type"); }}>
                {sort === "type" ? "✓ " : ""}Sort by Type
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  onSaveCurrentView();
                }}
              >
                Save current view
              </DropdownMenuItem>
              {savedViews.length > 0 ? (
                <>
                  <DropdownMenuSeparator />
                  {savedViews.map((view) => (
                    <DropdownMenuItem
                      key={view.id}
                      onSelect={(e) => {
                        e.preventDefault();
                        onApplySavedView(view.id);
                      }}
                    >
                      {selectedSavedViewId === view.id ? "✓ " : ""}
                      {view.name}
                    </DropdownMenuItem>
                  ))}
                </>
              ) : null}
              <DropdownMenuItem
                disabled={!selectedSavedViewId}
                onSelect={(e) => {
                  e.preventDefault();
                  onDeleteSavedView();
                }}
              >
                Delete saved view
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!canEdit}
                onSelect={(e) => {
                  e.preventDefault();
                  onOpenCreateFolder();
                }}
              >
                New folder
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canEdit}
                onSelect={(e) => {
                  e.preventDefault();
                  onOpenCreateFile();
                }}
              >
                New file
              </DropdownMenuItem>
              {uploadEnabled ? (
                <>
                  <DropdownMenuItem
                    disabled={!canEdit}
                    onSelect={(e) => {
                      e.preventDefault();
                      if (!canEdit) return;
                      const parentId =
                        selectedNode?.type === "folder"
                          ? selectedNode.id
                          : selectedNode?.parentId ?? selectedFolderId ?? null;
                      onUpload(parentId);
                    }}
                  >
                    Upload file
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!canEdit}
                    onSelect={(e) => {
                      e.preventDefault();
                      if (!canEdit) return;
                      const parentId =
                        selectedNode?.type === "folder"
                          ? selectedNode.id
                          : selectedNode?.parentId ?? selectedFolderId ?? null;
                      onUploadFolder(parentId);
                    }}
                  >
                    Upload folder
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="px-2 py-2 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center w-full min-w-0">
          <div className="flex items-center gap-1 shrink-0">
            <Button
              data-testid="files-explorer-mode-tree"
              type="button"
              size="sm"
              variant={explorerMode === "tree" ? "default" : "ghost"}
              className={cn("h-7 w-7 p-0", explorerMode === "tree" ? "" : "text-zinc-500")}
              onClick={() => onSetExplorerMode("tree")}
              title="All files"
            >
              <List className="w-4 h-4" />
            </Button>
            <Button
              data-testid="files-explorer-mode-favorites"
              type="button"
              size="sm"
              variant={explorerMode === "favorites" ? "default" : "ghost"}
              className={cn(
                "h-7 w-7 p-0",
                explorerMode === "favorites" ? "" : "text-zinc-500"
              )}
              onClick={() => onSetExplorerMode("favorites")}
              title="Favorites"
            >
              <Star className="w-4 h-4" />
            </Button>
            <Button
              data-testid="files-explorer-mode-recents"
              type="button"
              size="sm"
              variant={explorerMode === "recents" ? "default" : "ghost"}
              className={cn("h-7 w-7 p-0", explorerMode === "recents" ? "" : "text-zinc-500")}
              onClick={() => onSetExplorerMode("recents")}
              title="Recent files"
            >
              <Clock className="w-4 h-4" />
            </Button>
            <Button
              data-testid="files-explorer-mode-trash"
              type="button"
              size="sm"
              variant={explorerMode === "trash" ? "default" : "ghost"}
              className={cn("h-7 w-7 p-0", explorerMode === "trash" ? "" : "text-zinc-500")}
              onClick={() => onSetExplorerMode("trash")}
              disabled={!canEdit}
              title="Trash"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex-1 min-w-0 flex items-center justify-end ml-2">
            {explorerMode !== "sourceControl" && explorerMode !== "outline" ? (
              <div className="flex items-center min-w-0 justify-end w-full max-w-[200px]">
                <div
                  className={cn(
                    "overflow-hidden transition-all duration-200 ease-out flex-1",
                    inlineSearchOpen ? "opacity-100" : "max-w-0 opacity-0"
                  )}
                >
                  <Input
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => onSearchQueryChange(e.target.value)}
                    className="h-7 bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-xs px-2 w-full"
                  />
                </div>
                <Button
                  data-testid="files-explorer-search-toggle"
                  type="button"
                  size="sm"
                  variant={inlineSearchOpen ? "secondary" : "ghost"}
                  className="h-7 w-7 p-0 shrink-0 ml-1"
                  title="Search files"
                  onClick={onToggleInlineSearch}
                >
                  <Search className="w-4 h-4" />
                </Button>
              </div>
            ) : null}
            {isSearching ? <span className="text-xs text-zinc-400 ml-2 shrink-0">...</span> : null}
          </div>
        </div>
      </div>
    </>
  );
});
