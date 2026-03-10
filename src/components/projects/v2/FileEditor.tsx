"use client";

import React, { useEffect, useMemo, useState, useDeferredValue } from "react";
import { ProjectNode } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Copy, Diff, List, Loader2, MoreVertical, Play, Save, Settings, Trash2, Wand2, SplitSquareHorizontal } from "lucide-react";
import { useTheme } from "@/components/providers/theme-provider";
import dynamic from "next/dynamic";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui-custom/Toast";
import MarkdownPreview from "./preview/MarkdownPreview";

const CodeEditor = dynamic(() => import("./editor/CodeEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-zinc-500 bg-white dark:bg-[#1e1e1e]">
      <Loader2 className="w-5 h-5 animate-spin mr-2" />
      Loading editor...
    </div>
  ),
});
import Link from "next/link";
import type { Change } from "diff";
import { RunnerStatusStrip } from "./panels/RunnerStatusStrip";
import { formatProjectFileContent, getLastNodeEvent } from "@/app/actions/files";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import type { EditorSymbol } from "@/stores/files/types";

interface FileEditorProps {
  file: ProjectNode;
  content: string;
  savedSnapshot?: string;
  isDirty: boolean;
  isLoading: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  error?: string | null;
  canEdit: boolean;
  lockInfo?: { lockedBy: string; lockedByName?: string | null; expiresAt: number } | null;
  offlineQueued?: boolean;
  lineNumbers?: boolean;
  wordWrap?: boolean;
  fontSize?: number;
  minimapEnabled?: boolean;
  onChange: (next: string) => void;
  onSave: () => void;
  onRetryLoad: () => void;
  onDelete: () => void;
  lastSavedAt?: number;
  openDiffSignal?: number;
  onRun?: () => void;
  canRun?: boolean;
  gitStatus?: "modified" | "added" | "deleted" | null;
  tabId?: string;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

// 2d: Symbol sidebar item — recursive for nested symbols
function SymbolItem({
  symbol,
  projectId,
  nodeId,
  depth,
  onScrollTo,
}: {
  symbol: EditorSymbol;
  projectId: string;
  nodeId: string;
  depth: number;
  onScrollTo: (projectId: string, nodeId: string, line: number) => void;
}) {
  const kind = symbol.kind as unknown as number;
  const kindIcon = kind === 5 || kind === 11 ? "◇" : kind === 6 || kind === 12 ? "ƒ" : "·";

  return (
    <>
      <button
        type="button"
        className="w-full flex items-center gap-1 px-2 py-0.5 text-left text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 truncate transition-colors"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        onClick={() => onScrollTo(projectId, nodeId, symbol.range.startLineNumber)}
        title={`${symbol.name} (line ${symbol.range.startLineNumber})`}
      >
        <span className="text-[10px] text-zinc-400 w-3 flex-shrink-0">{kindIcon}</span>
        <span className="truncate">{symbol.name}</span>
        <span className="text-[9px] text-zinc-400 ml-auto flex-shrink-0 tabular-nums">{symbol.range.startLineNumber}</span>
      </button>
      {symbol.children?.map((child, idx) => (
        <SymbolItem
          key={`${child.name}-${idx}`}
          symbol={child}
          projectId={projectId}
          nodeId={nodeId}
          depth={depth + 1}
          onScrollTo={onScrollTo}
        />
      ))}
    </>
  );
}

export default function FileEditor({
  file,
  content,
  savedSnapshot = "",
  isDirty,
  isLoading,
  isSaving,
  isDeleting,
  error,
  canEdit,
  lockInfo = null,
  offlineQueued = false,
  lineNumbers = true,
  wordWrap = true,
  fontSize = 14,
  minimapEnabled = false,
  onChange,
  onSave,
  onRetryLoad,
  onDelete,
  lastSavedAt,
  openDiffSignal,
  onRun,
  canRun,
  gitStatus,
  tabId,
}: FileEditorProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDiffOpen, setIsDiffOpen] = useState(false);
  const [isFormatting, setIsFormatting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const { showToast } = useToast();
  const [symbolsOpen, setSymbolsOpen] = React.useState(false);

  // 2d: Symbol outline from store
  const activeFileSymbols = useFilesWorkspaceStore(
    (s) => s.byProjectId[file.projectId]?.activeFileSymbols || []
  );
  const requestScrollTo = useFilesWorkspaceStore((s) => s.requestScrollTo);

  // 2c: Sticky scroll context — find the enclosing symbol for cursor position
  const [cursorLine, setCursorLine] = React.useState<number | null>(null);
  const stickyScope = React.useMemo(() => {
    if (cursorLine === null || !activeFileSymbols.length) return null;
    // Find the deepest symbol containing cursor
    const findScope = (syms: typeof activeFileSymbols): string | null => {
      for (let i = syms.length - 1; i >= 0; i--) {
        const s = syms[i];
        if (cursorLine >= s.range.startLineNumber && cursorLine <= s.range.endLineNumber) {
          const childScope = s.children ? findScope(s.children) : null;
          return childScope ? `${s.name} › ${childScope}` : s.name;
        }
      }
      return null;
    };
    return findScope(activeFileSymbols);
  }, [cursorLine, activeFileSymbols]);

  // Defer content for preview to avoid typing lag
  const deferredContent = useDeferredValue(content);

  const isMarkdown = file.name.endsWith(".md");
  const modelPath = useMemo(
    () => `project-${file.projectId}/node-${file.id}/${file.name}`,
    [file.id, file.name, file.projectId]
  );

  useEffect(() => {
      setShowPreview(false);
  }, [file.id]);

  useEffect(() => {
    if (!openDiffSignal) return;
    setIsDiffOpen(true);
  }, [openDiffSignal]);

  const [lastEvent, setLastEvent] = useState<{ type: string; at: number; by: string | null } | null>(null);
  
  
  const setActiveFileSymbols = useFilesWorkspaceStore((s) => s.setActiveFileSymbols);
  const requestedScrollPosition = useFilesWorkspaceStore((s) => s.byProjectId[file.projectId]?.requestedScrollPosition);
  const clearScrollRequest = useFilesWorkspaceStore((s) => s.clearScrollRequest);

  const scrollToLine = useMemo(() => {
     if (requestedScrollPosition && requestedScrollPosition.nodeId === file.id) {
         return requestedScrollPosition.line;
     }
     return null;
  }, [requestedScrollPosition, file.id]);

  useEffect(() => {
      if (scrollToLine) {
          const t = setTimeout(() => {
              clearScrollRequest(file.projectId);
          }, 100); // clear quickly
          return () => clearTimeout(t);
      }
  }, [scrollToLine, file.projectId, clearScrollRequest]);

  const confirmTitle = useMemo(() => {
    if (isDirty) return "Move to Trash (unsaved changes)";
    return "Move to Trash";
  }, [isDirty]);

  const formatParserSupported = useMemo(() => {
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    return ["ts", "tsx", "js", "jsx", "json", "md", "css", "html", "sql"].includes(ext);
  }, [file.name]);

  const deferredDiffContent = useDeferredValue(content);
  const [diffParts, setDiffParts] = useState<Change[]>([]);
  useEffect(() => {
    if (!isDiffOpen) { setDiffParts([]); return; }
    let cancelled = false;
    void import("diff").then(({ diffLines }) => {
      if (!cancelled) setDiffParts(diffLines(savedSnapshot || "", deferredDiffContent || ""));
    });
    return () => { cancelled = true; };
  }, [deferredDiffContent, isDiffOpen, savedSnapshot]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const evt = await getLastNodeEvent(file.projectId, file.id);
        if (!cancelled) setLastEvent(evt);
      } catch {
        if (!cancelled) setLastEvent(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file.id, file.projectId]);

  const rootRef = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!canRun || !onRun) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      if (!rootRef.current?.contains(target)) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        onRun();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [canRun, onRun]);

  const handleFormat = async () => {
    if (!canEdit) return;
    if (!formatParserSupported) {
      showToast("Formatting is not supported for this file type yet", "info");
      return;
    }
    setIsFormatting(true);
    try {
      const formatted = await formatProjectFileContent(file.projectId, file.name, content);
      if (formatted === content) {
        showToast("No formatting changes", "info");
        return;
      }
      onChange(formatted);
      showToast("Formatted", "success");
    } catch (error: unknown) {
      showToast(getErrorMessage(error, "Failed to format file"), "error");
    } finally {
      setIsFormatting(false);
    }
  };

  const handleCopyPath = async () => {
    const pathToCopy = file.path || file.name;
    try {
      await navigator.clipboard.writeText(pathToCopy);
      showToast("Path copied", "success");
    } catch {
      showToast("Failed to copy path", "error");
    }
  };

  return (
    <div ref={rootRef} className="flex flex-col h-full bg-white dark:bg-[#1e1e1e]">
      {/* Header / Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-[#1e1e1e]">
        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 font-mono truncate max-w-[180px]">
            {file.name}
          </span>
          <span className="text-[11px] text-zinc-400 flex-shrink-0">
            {((file.size || 0) / 1024).toFixed(1)} KB
          </span>
          {isDirty && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 flex-shrink-0">
              Unsaved
            </span>
          )}
          {!canEdit && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 flex-shrink-0">
              Read-only
            </span>
          )}
          {!canEdit && lockInfo ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 flex-shrink-0 truncate max-w-[160px]">
              {lockInfo.lockedByName || lockInfo.lockedBy}
            </span>
          ) : null}
          {offlineQueued ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 flex-shrink-0">
              Offline queued
            </span>
          ) : null}
          {lastSavedAt ? (
            <span className="text-xs text-zinc-400 flex-shrink-0">
              Saved {new Date(lastSavedAt).toLocaleTimeString()}
            </span>
          ) : null}
          {lastEvent ? (
            <span className="text-[11px] text-zinc-400 flex-shrink-0 truncate max-w-[220px]">
              {lastEvent.type} {lastEvent.by ? `· ${lastEvent.by}` : ""}
            </span>
          ) : null}
        </div>

        {canRun && (
          <div className="hidden sm:flex items-center mx-2">
            <RunnerStatusStrip />
          </div>
        )}

        <div className="flex items-center gap-1.5">
          {canRun && onRun ? (
            <Button
              data-testid="files-editor-run"
              size="sm"
              variant="outline"
              className="h-7 px-2"
              onClick={onRun}
              title="Run (Ctrl+Enter)"
            >
              <Play className="w-3.5 h-3.5 mr-1.5" />
              Run
            </Button>
          ) : null}
          <Link
            href="/settings/languages"
            className="inline-flex items-center justify-center h-7 px-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 text-sm font-medium transition-colors"
            title="Languages & runtimes"
          >
            <Settings className="w-3.5 h-3.5" />
          </Link>
          <Button
            data-testid="files-editor-save"
            size="sm"
            onClick={onSave}
            disabled={!canEdit || isSaving || !isDirty}
            variant="default"
            className="h-7 px-2"
            title={!canEdit ? "You don't have permission to edit" : undefined}
          >
            {isSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
            ) : (
              <Save className="w-3.5 h-3.5 mr-1.5" />
            )}
            Save
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                data-testid="files-editor-actions"
                size="sm"
                variant="outline"
                className="h-7 px-2"
                title="Editor actions"
              >
                <MoreVertical className="w-3.5 h-3.5 mr-1.5" />
                Actions
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  void handleCopyPath();
                }}
              >
                <Copy className="w-3.5 h-3.5 mr-2" />
                Copy path
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setIsDiffOpen(true);
                }}
                disabled={isLoading}
              >
                <Diff className="w-3.5 h-3.5 mr-2" />
                Diff
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  void handleFormat();
                }}
                disabled={!canEdit || isFormatting || isLoading}
              >
                {isFormatting ? (
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                ) : (
                  <Wand2 className="w-3.5 h-3.5 mr-2" />
                )}
                Format
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setIsDeleteOpen(true);
                }}
                disabled={!canEdit || isDeleting}
              >
                {isDeleting ? (
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5 mr-2" />
                )}
                Trash
              </DropdownMenuItem>
              {isMarkdown ? (
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setShowPreview((prev) => !prev);
                  }}
                >
                  <SplitSquareHorizontal className="w-3.5 h-3.5 mr-2" />
                  {showPreview ? "Hide preview" : "Show preview"}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setSymbolsOpen((prev) => !prev);
                }}
              >
                <List className="w-3.5 h-3.5 mr-2" />
                {symbolsOpen ? "Hide symbols" : "Symbols"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* 2c: Sticky Scroll Symbol Header */}
      {stickyScope && (
        <div className="flex items-center gap-2 px-3 py-1 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/80 backdrop-blur-sm">
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono truncate">
            {stickyScope}
          </span>
        </div>
      )}

      {/* Editor Area + Symbol Sidebar */}
      <div className="flex-1 relative overflow-hidden min-h-0 flex">
        {/* 2d: Symbol outline sidebar */}
        {symbolsOpen && activeFileSymbols.length > 0 && (
          <div className="w-48 flex-shrink-0 border-r border-zinc-200 dark:border-zinc-800 overflow-y-auto bg-zinc-50/50 dark:bg-zinc-900/50">
            <div className="px-2 py-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-100 dark:border-zinc-800">
              Symbols
            </div>
            <div className="py-1">
              {activeFileSymbols.map((sym, idx) => (
                <SymbolItem
                  key={`${sym.name}-${idx}`}
                  symbol={sym}
                  projectId={file.projectId}
                  nodeId={file.id}
                  depth={0}
                  onScrollTo={requestScrollTo}
                />
              ))}
            </div>
          </div>
        )}

        {/* Editor content */}
        <div className="flex-1 overflow-hidden min-h-0 min-w-0">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-zinc-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading content...
          </div>
        ) : error ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center">
            <div className="max-w-lg">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Couldn’t load file content
              </p>
              <p className="text-sm text-zinc-500 mt-2 break-words">{error}</p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <Button variant="outline" onClick={onRetryLoad}>
                  Retry
                </Button>
              </div>
              <p className="text-xs text-zinc-400 mt-4">
                You can still edit below; saving will write to storage when available.
              </p>
            </div>
            <div className="mt-6 w-full flex-1 min-h-[200px] border rounded-lg overflow-hidden border-zinc-200 dark:border-zinc-800">
              <CodeEditor
                filename={file.name}
                modelPath={modelPath}
                value={content}
                onChange={onChange}
                theme={isDark ? "dark" : "light"}
                readOnly={!canEdit}
                lineNumbers={lineNumbers}
                wordWrap={wordWrap}
                fontSize={fontSize}
                minimapEnabled={minimapEnabled}
                onSymbolsChange={(syms) => setActiveFileSymbols(file.projectId, syms)}
                scrollToLine={scrollToLine}
                onCursorChange={setCursorLine}
                gitStatus={gitStatus}
                tabId={tabId}
              />
            </div>
          </div>
        ) : (
             showPreview && isMarkdown ? (
                <div className="absolute inset-0 flex">
                    <div className="w-1/2 h-full border-r border-zinc-200 dark:border-zinc-800">
                         <CodeEditor
                            filename={file.name}
                            modelPath={modelPath}
                            value={content}
                            onChange={onChange}
                            theme={isDark ? "dark" : "light"}
                            readOnly={!canEdit}
                            lineNumbers={lineNumbers}
                            wordWrap={wordWrap}
                            fontSize={fontSize}
                            minimapEnabled={minimapEnabled}
                            onSymbolsChange={(syms) => setActiveFileSymbols(file.projectId, syms)}
                            scrollToLine={scrollToLine}
                            onCursorChange={setCursorLine}
                            gitStatus={gitStatus}
                            tabId={tabId}
                          />
                    </div>
                    <div className="w-1/2 h-full">
                        <MarkdownPreview content={deferredContent} />
                    </div>
                </div>
            ) : (
              <CodeEditor
                filename={file.name}
                modelPath={modelPath}
                value={content}
                onChange={onChange}
                theme={isDark ? "dark" : "light"}
                readOnly={!canEdit}
                lineNumbers={lineNumbers}
                wordWrap={wordWrap}
                fontSize={fontSize}
                minimapEnabled={minimapEnabled}
                onSymbolsChange={(syms) => setActiveFileSymbols(file.projectId, syms)}
                scrollToLine={scrollToLine}
                gitStatus={gitStatus}
                tabId={tabId}
              />
            )
        )}
        </div>
      </div>

      <Dialog open={isDiffOpen} onOpenChange={setIsDiffOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Local changes</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
            <pre className="text-xs font-mono p-3 leading-5">
              {diffParts.map((p, idx) => (
                <span
                  key={idx}
                  className={
                    p.added
                      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200"
                      : p.removed
                        ? "bg-rose-100 text-rose-900 dark:bg-rose-900/20 dark:text-rose-200"
                        : ""
                  }
                >
                  {p.value}
                </span>
              ))}
            </pre>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDiffOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmTitle}</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-zinc-600 dark:text-zinc-300 space-y-2">
            <p>
              This will move <span className="font-mono font-semibold">{file.name}</span> to Trash.
            </p>
            {isDirty ? (
              <p className="text-amber-700 dark:text-amber-300">
                You have unsaved changes. Moving to Trash will discard them.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteOpen(false)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setIsDeleteOpen(false);
                onDelete();
              }}
              disabled={!canEdit || isDeleting}
            >
                Move to Trash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
