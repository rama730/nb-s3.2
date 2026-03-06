"use client";

import React, { useMemo, useEffect, useRef } from "react";
import { Loader2, GitBranch, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FilesWorkspaceTabState, PaneId } from "../state/filesTabTypes";
import { getFileContent, useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";

/* ─── Language detection (extension → label) ─────────────── */
const EXT_LANG: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript React",
  ".js": "JavaScript",
  ".jsx": "JavaScript React",
  ".py": "Python",
  ".java": "Java",
  ".c": "C",
  ".cpp": "C++",
  ".cc": "C++",
  ".go": "Go",
  ".rs": "Rust",
  ".sql": "SQL",
  ".json": "JSON",
  ".html": "HTML",
  ".css": "CSS",
  ".scss": "SCSS",
  ".md": "Markdown",
  ".yaml": "YAML",
  ".yml": "YAML",
  ".xml": "XML",
  ".sh": "Shell",
  ".bash": "Shell",
  ".rb": "Ruby",
  ".php": "PHP",
  ".swift": "Swift",
  ".kt": "Kotlin",
};

function getLang(fileName?: string): string {
  if (!fileName) return "Plain Text";
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return "Plain Text";
  return EXT_LANG[fileName.slice(dot).toLowerCase()] ?? "Plain Text";
}

interface StatusBarProps {
  projectId: string;
  activePane: PaneId;
  activeTabId: string | null;
  tabById: Record<string, FilesWorkspaceTabState>;
}

export function StatusBar({ projectId, activePane, activeTabId, tabById }: StatusBarProps) {
  const activeTab = activeTabId ? tabById[activeTabId] : null;

  // Phase 5: Read content from detached Map for line count
  const lineCount = React.useMemo(() => {
    if (!activeTabId) return 0;
    const _v = activeTab?.contentVersion; // dependency trigger
    const text = getFileContent(projectId, activeTabId);
    if (!text) return 0;
    let count = 1;
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) count++;
    }
    return count;
  }, [projectId, activeTabId, activeTab?.contentVersion]);

  const lang = getLang(activeTab?.node?.name);

  // Transient cursor tracking
  const cursorRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const handleCursor = (e: any) => {
      const { line, column, tabId } = e.detail || {};
      if (tabId === activeTabId && cursorRef.current) {
        cursorRef.current.textContent = `Ln ${line}, Col ${column || 1}`;
      }
    };
    window.addEventListener("cursor-moved", handleCursor);
    return () => window.removeEventListener("cursor-moved", handleCursor);
  }, [activeTabId]);

  const gitSyncStatus = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.git?.gitStatusLoaded === false ? "syncing" : "idle"
  );
  const gitBranch = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.git?.branch || "main"
  );

  if (!activeTab) return null;

  return (
    <div className="flex items-center justify-between px-3 h-[24px] shrink-0 bg-indigo-600 dark:bg-indigo-700/80 backdrop-blur-sm text-white text-[11px] font-medium select-none z-20 border-t border-indigo-500/30">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5 hover:bg-white/10 px-1.5 py-0.5 rounded transition-colors cursor-pointer">
          <GitBranch className="w-3 h-3 opacity-80" />
          <span>{gitBranch}</span>
          {gitSyncStatus === "syncing" && (
            <Loader2 className="w-2.5 h-2.5 animate-spin opacity-80" />
          )}
        </div>
        <div className="flex items-center gap-1.5 opacity-90 truncate max-w-[200px]">
          <span className="opacity-60">nb-s3 /</span>
          <span>{activeTab.node?.name ?? "Untitled"}</span>
        </div>
      </div>

      <div className="flex items-center gap-4 h-full">
        <div className="flex items-center gap-4 opacity-80 h-full border-x border-white/10 px-4">
          <span ref={cursorRef}>Ln 1, Col 1</span>
          <span>Spaces: 2</span>
          <span>UTF-8</span>
        </div>
        <div className="flex items-center gap-2 hover:bg-white/10 px-2 h-full transition-colors cursor-pointer">
          <Terminal className="w-3 h-3 opacity-80" />
          <span>{lang}</span>
        </div>
      </div>
    </div>
  );
}
