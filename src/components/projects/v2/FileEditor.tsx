"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ProjectNode } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Diff, Loader2, Save, Trash2, Wand2 } from "lucide-react";
import { useTheme } from "next-themes";
import dynamic from "next/dynamic";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const CodeEditor = dynamic(() => import("./editor/CodeEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-zinc-500 bg-white dark:bg-[#1e1e1e]">
      <Loader2 className="w-5 h-5 animate-spin mr-2" />
      Loading editor...
    </div>
  ),
});
import { diffLines } from "diff";
import { formatProjectFileContent, getLastNodeEvent } from "@/app/actions/files";

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
}: FileEditorProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDiffOpen, setIsDiffOpen] = useState(false);
  const [isFormatting, setIsFormatting] = useState(false);
  const [lastEvent, setLastEvent] = useState<{ type: string; at: number; by: string | null } | null>(null);

  const confirmTitle = useMemo(() => {
    if (isDirty) return "Move to Trash (unsaved changes)";
    return "Move to Trash";
  }, [isDirty]);

  const diffParts = useMemo(() => {
    if (!isDiffOpen) return [];
    return diffLines(savedSnapshot || "", content || "");
  }, [content, isDiffOpen, savedSnapshot]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const evt = await getLastNodeEvent(file.projectId, file.id);
        if (!cancelled) setLastEvent(evt as any);
      } catch {
        if (!cancelled) setLastEvent(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file.id, file.projectId]);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#1e1e1e]">
      {/* Header / Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-[#1e1e1e]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300 font-mono truncate">
            {file.name}
          </span>
          <span className="text-xs text-zinc-400 flex-shrink-0">
            {((file.size || 0) / 1024).toFixed(1)} KB
          </span>
          {isDirty && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 flex-shrink-0">
              Unsaved
            </span>
          )}
          {!canEdit && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 flex-shrink-0">
              Read-only
            </span>
          )}
          {!canEdit && lockInfo ? (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 flex-shrink-0">
              Locked by {lockInfo.lockedByName || lockInfo.lockedBy}
            </span>
          ) : null}
          {offlineQueued ? (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 flex-shrink-0">
              Offline queued
            </span>
          ) : null}
          {lastSavedAt ? (
            <span className="text-xs text-zinc-400 flex-shrink-0">
              Saved {new Date(lastSavedAt).toLocaleTimeString()}
            </span>
          ) : null}
          {lastEvent ? (
            <span className="text-xs text-zinc-400 flex-shrink-0">
              Last {lastEvent.type} {lastEvent.by ? `by ${lastEvent.by}` : ""} @{" "}
              {new Date(lastEvent.at).toLocaleTimeString()}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => setIsDiffOpen(true)}
            disabled={isLoading}
            variant="outline"
            className="h-8"
            title="View local changes"
          >
            <Diff className="w-4 h-4 mr-2" />
            Diff
          </Button>

          <Button
            size="sm"
            onClick={async () => {
              if (!canEdit) return;
              setIsFormatting(true);
              try {
                const formatted = await formatProjectFileContent(
                  file.projectId,
                  file.name,
                  content
                );
                onChange(formatted);
              } finally {
                setIsFormatting(false);
              }
            }}
            disabled={!canEdit || isFormatting || isLoading}
            variant="outline"
            className="h-8"
            title={!canEdit ? "You don't have permission to edit" : "Format file"}
          >
            {isFormatting ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Wand2 className="w-4 h-4 mr-2" />
            )}
            Format
          </Button>

          <Button
            size="sm"
            onClick={() => setIsDeleteOpen(true)}
            disabled={!canEdit || isDeleting}
            variant="outline"
            className="h-8"
            title={!canEdit ? "You don't have permission to edit" : "Move to Trash"}
          >
            {isDeleting ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Trash2 className="w-4 h-4 mr-2" />
            )}
            Trash
          </Button>

          <Button
            size="sm"
            onClick={onSave}
            disabled={!canEdit || isSaving || !isDirty}
            variant="default"
            className="h-8"
            title={!canEdit ? "You don't have permission to edit" : undefined}
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Save
          </Button>
        </div>
      </div>

      {/* Editor Area */}
      <div className="flex-1 relative overflow-hidden">
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
                value={content}
                onChange={onChange}
                theme={isDark ? "dark" : "light"}
                readOnly={!canEdit}
                lineNumbers={lineNumbers}
                wordWrap={wordWrap}
                fontSize={fontSize}
                minimapEnabled={minimapEnabled}
              />
            </div>
          </div>
        ) : (
          <CodeEditor
            filename={file.name}
            value={content}
            onChange={onChange}
            theme={isDark ? "dark" : "light"}
            readOnly={!canEdit}
            lineNumbers={lineNumbers}
            wordWrap={wordWrap}
            fontSize={fontSize}
            minimapEnabled={minimapEnabled}
          />
        )}
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
