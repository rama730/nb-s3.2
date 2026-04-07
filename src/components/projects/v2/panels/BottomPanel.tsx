"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Play, FileOutput, AlertTriangle, ChevronDown, ChevronUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import type { UiState, Problem } from "@/stores/files/types";
import { RunTab } from "./RunTab";
import { OutputTab } from "./OutputTab";
import { ProblemsTab } from "./ProblemsTab";

interface BottomPanelProps {
  projectId: string;
  canEdit: boolean;
  problems?: Problem[];
  activeFilePath?: string;
  /** Content of active file for input() count hint (when .py) */
  activeFileContent?: string;
  /** Callback to re-run the active file (passed to OutputTab) */
  onRun?: () => void;
  onNavigateToFile?: (nodeId: string, line?: number) => void;
  onToggle?: () => void;
}

type TabId = UiState["bottomPanelTab"];

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "run", label: "Run", icon: Play },
  { id: "output", label: "Output", icon: FileOutput },
  { id: "problems", label: "Problems", icon: AlertTriangle },
];

const MIN_HEIGHT = 100;
const DEFAULT_HEIGHT = 250;
const COLLAPSED_HEIGHT = 28;

export function BottomPanel({
  projectId,
  canEdit,
  problems = [],
  activeFilePath,
  activeFileContent,
  onRun,
  onNavigateToFile,
  onToggle,
}: BottomPanelProps) {
  const activeTab = useFilesWorkspaceStore((s) => s._get(projectId).ui.bottomPanelTab);
  const panelHeight = useFilesWorkspaceStore((s) => s._get(projectId).ui.bottomPanelHeight);
  const collapsed = useFilesWorkspaceStore((s) => s._get(projectId).ui.bottomPanelCollapsed);
  const setTab = useFilesWorkspaceStore((s) => s.setBottomPanelTab);
  const setHeight = useFilesWorkspaceStore((s) => s.setBottomPanelHeight);
  const toggle = useFilesWorkspaceStore((s) => s.toggleBottomPanel);

  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ y: number; h: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const errorCount = problems.filter((p) => p.severity === "error").length;
  const height = panelHeight || DEFAULT_HEIGHT;

  const handleTabClick = useCallback(
    (tabId: TabId) => {
      if (collapsed) {
        toggle(projectId);
        setTab(projectId, tabId);
      } else if (activeTab === tabId) {
        // Keep panel open on active-tab clicks; collapse is explicit via chevron/close.
        return;
      } else {
        setTab(projectId, tabId);
      }
    },
    [collapsed, activeTab, projectId, toggle, setTab]
  );

  // --- Resize logic ---
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragStartRef.current = { y: e.clientY, h: height };
      setIsDragging(true);
    },
    [height]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const parent = panelRef.current?.parentElement;
      const maxHeight = parent ? parent.clientHeight * 0.6 : 600;
      const delta = dragStartRef.current.y - e.clientY;
      const next = Math.min(maxHeight, Math.max(MIN_HEIGHT, dragStartRef.current.h + delta));
      setHeight(projectId, next);
    };

    const handleMouseUp = () => {
      dragStartRef.current = null;
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, projectId, setHeight]);

  // --- Ctrl+` keyboard shortcut ---
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        toggle(projectId);
        onToggle?.();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [projectId, toggle, onToggle]);

  return (
    <div
      ref={panelRef}
      style={{ height: collapsed ? COLLAPSED_HEIGHT : height }}
      className={cn(
        "border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 flex flex-col shrink-0",
        isDragging ? "select-none" : ""
      )}
    >
      {/* Drag handle */}
      {!collapsed && (
        <div
          className="h-[3px] cursor-row-resize hover:bg-blue-500/40 active:bg-blue-500/60 transition-colors shrink-0"
          onMouseDown={handleMouseDown}
        />
      )}

      {/* Tab bar */}
      <div className="flex items-center gap-0.5 px-1 shrink-0 bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-200 dark:border-zinc-800">
        <span className="px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
          Console
        </span>
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id && !collapsed;
          return (
            <button
              key={tab.id}
              data-testid={`files-bottom-panel-tab-${tab.id}`}
              className={cn(
                "flex items-center gap-1 px-2 h-[27px] text-[11px] font-medium rounded-t transition-colors",
                isActive
                  ? "text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-950 border-b-2 border-blue-500"
                  : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              )}
              onClick={() => handleTabClick(tab.id)}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
              {tab.id === "problems" && errorCount > 0 && (
                <span className="ml-1 px-1.5 py-px text-[10px] leading-tight rounded-full bg-red-500 text-white font-medium">
                  {errorCount}
                </span>
              )}
            </button>
          );
        })}

        <div className="ml-auto flex items-center gap-0.5">
          <Button
            data-testid="files-bottom-panel-toggle"
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => toggle(projectId)}
            title={collapsed ? "Expand panel" : "Collapse panel"}
          >
            {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </Button>
          {!collapsed && (
            <Button
              data-testid="files-bottom-panel-close"
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => {
                toggle(projectId);
                onToggle?.();
              }}
              title="Close panel"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Tab content — only the active tab renders */}
      {!collapsed && (
        <div className="flex-1 min-h-0 overflow-hidden">
          {activeTab === "run" && (
            <RunTab
              projectId={projectId}
              canEdit={canEdit}
              activeFilePath={activeFilePath}
              activeFileContent={activeFileContent}
            />
          )}
          {activeTab === "output" && <OutputTab projectId={projectId} onRun={onRun} />}
          {activeTab === "problems" && (
            <ProblemsTab
              projectId={projectId}
              problems={problems}
              onNavigateToFile={onNavigateToFile}
            />
          )}
        </div>
      )}
    </div>
  );
}
