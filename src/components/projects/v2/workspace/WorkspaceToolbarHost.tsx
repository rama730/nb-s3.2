"use client";

import React from "react";
import { Layers, MoreVertical, PanelBottom, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WorkspaceGitToolbar } from "./WorkspaceGitToolbar";

interface WorkspaceToolbarHostProps {
  projectId: string;
  canEdit: boolean;
  viewMode: "code" | "assets" | "all";
  splitEnabled: boolean;
  bottomPanelCollapsed: boolean;
  headerSearchOpen: boolean;
  headerSearchQuery: string;
  dirtyTabIds: string[];
  wave1SaveAllEnabled: boolean;
  onToggleHeaderSearch: () => void;
  onHeaderSearchQueryChange: (value: string) => void;
  onHeaderSearchKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onSaveAllDirtyTabs: () => void;
  onSetViewMode: (mode: "code" | "assets" | "all") => void;
  onToggleBottomPanel: () => void;
  onOpenQuickOpen: () => void;
  onOpenFindInProject: () => void;
  onOpenCommandPalette: () => void;
  onToggleSplit: () => void;
  onToggleLineNumbers: () => void;
  onToggleWordWrap: () => void;
  onToggleMinimap: () => void;
  onFontSizeDecrease: () => void;
  onFontSizeIncrease: () => void;
  prefs: {
    lineNumbers: boolean;
    wordWrap: boolean;
    minimap: boolean;
  };
}

export function WorkspaceToolbarHost({
  projectId,
  canEdit,
  viewMode,
  splitEnabled,
  bottomPanelCollapsed,
  headerSearchOpen,
  headerSearchQuery,
  dirtyTabIds,
  wave1SaveAllEnabled,
  onToggleHeaderSearch,
  onHeaderSearchQueryChange,
  onHeaderSearchKeyDown,
  onSaveAllDirtyTabs,
  onSetViewMode,
  onToggleBottomPanel,
  onOpenQuickOpen,
  onOpenFindInProject,
  onOpenCommandPalette,
  onToggleSplit,
  onToggleLineNumbers,
  onToggleWordWrap,
  onToggleMinimap,
  onFontSizeDecrease,
  onFontSizeIncrease,
  prefs,
}: WorkspaceToolbarHostProps) {
  return (
    <div className="relative z-10 flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 backdrop-blur">
      <div className="flex items-center gap-2 min-w-0">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 shrink-0">
          Editor
        </div>
        {headerSearchOpen ? (
          <input
            autoFocus
            value={headerSearchQuery}
            onChange={(e) => onHeaderSearchQueryChange(e.target.value)}
            onKeyDown={onHeaderSearchKeyDown}
            placeholder="Search files..."
            className="h-7 w-[180px] rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 text-xs outline-none"
          />
        ) : null}
      </div>

      <div className="flex items-center gap-1.5">
        {wave1SaveAllEnabled ? (
          <Button
            data-testid="files-workspace-save-all"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={onSaveAllDirtyTabs}
            disabled={!canEdit || dirtyTabIds.length === 0}
            title="Save all dirty tabs"
          >
            Save all{dirtyTabIds.length > 0 ? ` (${dirtyTabIds.length})` : ""}
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              data-testid="files-workspace-view-mode"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
            >
              <Layers className="w-3.5 h-3.5 mr-1.5" />
              {viewMode === "code" ? "Code" : viewMode === "assets" ? "Assets" : "All"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onSetViewMode("code")}>Code</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSetViewMode("assets")}>Assets</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSetViewMode("all")}>All</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          data-testid="files-workspace-toolbar-search-toggle"
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0"
          onClick={onToggleHeaderSearch}
          title="Search files"
        >
          <Search className="w-3.5 h-3.5" />
        </Button>

        <WorkspaceGitToolbar projectId={projectId} canEdit={canEdit} />

        <Button
          data-testid="files-workspace-toolbar-panel-toggle"
          size="sm"
          variant={!bottomPanelCollapsed ? "secondary" : "outline"}
          className="h-7 px-2 text-xs"
          onClick={onToggleBottomPanel}
          title={bottomPanelCollapsed ? "Show panel (Ctrl+`)" : "Hide panel (Ctrl+`)"}
        >
          <PanelBottom className="w-3.5 h-3.5 mr-1.5" />
          Panel
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              data-testid="files-workspace-toolbar-menu"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
            >
              <MoreVertical className="w-3.5 h-3.5 mr-1.5" />
              Workspace
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={onOpenQuickOpen}>Quick open</DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenFindInProject}>Find in project</DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenCommandPalette}>Command palette</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onToggleSplit}>
              {splitEnabled ? "Single editor mode" : "Split editor mode"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onToggleLineNumbers}>
              {prefs.lineNumbers ? "Hide" : "Show"} line numbers
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleWordWrap}>
              {prefs.wordWrap ? "Disable" : "Enable"} word wrap
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleMinimap}>
              {prefs.minimap ? "Hide" : "Show"} minimap
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onFontSizeDecrease}>Font size -</DropdownMenuItem>
            <DropdownMenuItem onClick={onFontSizeIncrease}>Font size +</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
