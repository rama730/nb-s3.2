"use client";

import * as React from "react";
import { X, ArrowRight, Loader2 } from "lucide-react";
import { diffLines } from "diff";
import { cn } from "@/lib/utils";
import { getFileVersionContentAction } from "@/app/actions/files/versions";

interface AlignedLine {
  type: "added" | "removed" | "unchanged" | "empty";
  content: string;
  lineNumber?: number;
}

export interface FileVersionCompareViewProps {
  projectId: string;
  nodeId: string;
  fileName: string;
  baseVersion: number;
  targetVersion: number;
  onClose: () => void;
}

export function FileVersionCompareView({
  projectId,
  nodeId,
  fileName,
  baseVersion,
  targetVersion,
  onClose,
}: FileVersionCompareViewProps): React.JSX.Element {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [leftLines, setLeftLines] = React.useState<AlignedLine[]>([]);
  const [rightLines, setRightLines] = React.useState<AlignedLine[]>([]);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    async function loadDiffs() {
      try {
        const [baseRes, targetRes] = await Promise.all([
          getFileVersionContentAction(projectId, nodeId, baseVersion),
          getFileVersionContentAction(projectId, nodeId, targetVersion),
        ]);

        if (!active) return;

        if (!baseRes.success || !targetRes.success) {
          throw new Error("Failed to retrieve file contents for comparison.");
        }

        const baseContent = baseRes.content;
        const targetContent = targetRes.content;

        // Perform line diff computation
        const diffChunks = diffLines(baseContent, targetContent);

        interface LineGroup {
          type: "added" | "removed" | "unchanged";
          lines: string[];
        }

        const groups: LineGroup[] = [];
        for (let i = 0; i < diffChunks.length; i++) {
          const chunk = diffChunks[i];
          if (!chunk) continue;
          const lines = chunk.value.split(/\r?\n/);
          if (lines.length > 1 && lines[lines.length - 1] === "") {
            lines.pop();
          }
          groups.push({
            type: chunk.added ? "added" : chunk.removed ? "removed" : "unchanged",
            lines,
          });
        }
        
        const localLeft: AlignedLine[] = [];
        const localRight: AlignedLine[] = [];
        let leftLineNum = 1;
        let rightLineNum = 1;

        let i = 0;
        while (i < groups.length) {
          const current = groups[i]!;
          const next = groups[i + 1];

          if (current.type === "removed" && next && next.type === "added") {
            const removedLines = current.lines;
            const addedLines = next.lines;
            const maxLen = Math.max(removedLines.length, addedLines.length);

            for (let k = 0; k < maxLen; k++) {
              if (k < removedLines.length && k < addedLines.length) {
                localLeft.push({ type: "removed", content: removedLines[k]!, lineNumber: leftLineNum++ });
                localRight.push({ type: "added", content: addedLines[k]!, lineNumber: rightLineNum++ });
              } else if (k < removedLines.length) {
                localLeft.push({ type: "removed", content: removedLines[k]!, lineNumber: leftLineNum++ });
                localRight.push({ type: "empty", content: "" });
              } else {
                localLeft.push({ type: "empty", content: "" });
                localRight.push({ type: "added", content: addedLines[k]!, lineNumber: rightLineNum++ });
              }
            }
            i += 2;
          } else if (current.type === "added" && next && next.type === "removed") {
            const addedLines = current.lines;
            const removedLines = next.lines;
            const maxLen = Math.max(addedLines.length, removedLines.length);

            for (let k = 0; k < maxLen; k++) {
              if (k < addedLines.length && k < removedLines.length) {
                localLeft.push({ type: "removed", content: removedLines[k]!, lineNumber: leftLineNum++ });
                localRight.push({ type: "added", content: addedLines[k]!, lineNumber: rightLineNum++ });
              } else if (k < removedLines.length) {
                localLeft.push({ type: "removed", content: removedLines[k]!, lineNumber: leftLineNum++ });
                localRight.push({ type: "empty", content: "" });
              } else {
                localLeft.push({ type: "empty", content: "" });
                localRight.push({ type: "added", content: addedLines[k]!, lineNumber: rightLineNum++ });
              }
            }
            i += 2;
          } else {
            if (current.type === "added") {
              current.lines.forEach((line) => {
                localLeft.push({ type: "empty", content: "" });
                localRight.push({ type: "added", content: line, lineNumber: rightLineNum++ });
              });
            } else if (current.type === "removed") {
              current.lines.forEach((line) => {
                localLeft.push({ type: "removed", content: line, lineNumber: leftLineNum++ });
                localRight.push({ type: "empty", content: "" });
              });
            } else {
              current.lines.forEach((line) => {
                localLeft.push({ type: "unchanged", content: line, lineNumber: leftLineNum++ });
                localRight.push({ type: "unchanged", content: line, lineNumber: rightLineNum++ });
              });
            }
            i += 1;
          }
        }

        if (active) {
          setLeftLines(localLeft);
          setRightLines(localRight);
          setLoading(false);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "An unexpected error occurred loading comparisons.");
          setLoading(false);
        }
      }
    }

    void loadDiffs();

    return () => {
      active = false;
    };
  }, [projectId, nodeId, baseVersion, targetVersion]);

  // Synchronized scroll handlers
  const leftScrollRef = React.useRef<HTMLDivElement>(null);
  const rightScrollRef = React.useRef<HTMLDivElement>(null);

  const handleLeftScroll = React.useCallback(() => {
    if (leftScrollRef.current && rightScrollRef.current) {
      rightScrollRef.current.scrollTop = leftScrollRef.current.scrollTop;
    }
  }, []);

  const handleRightScroll = React.useCallback(() => {
    if (leftScrollRef.current && rightScrollRef.current) {
      leftScrollRef.current.scrollTop = rightScrollRef.current.scrollTop;
    }
  }, []);

  if (loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 p-8 dark:bg-zinc-900">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400 dark:text-zinc-500" />
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">Computing comparison changes...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 p-8 dark:bg-zinc-900">
        <p className="text-sm font-semibold text-red-500">{error}</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 rounded bg-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        >
          Close Compare Mode
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-md overflow-hidden shadow-md">
      {/* Compare View Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Compare Mode</span>
          <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100 font-mono bg-zinc-200 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
            v{baseVersion}
          </span>
          <ArrowRight className="h-3.5 w-3.5 text-zinc-400" />
          <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100 font-mono bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200 px-1.5 py-0.5 rounded">
            v{targetVersion} (Current)
          </span>
          <span className="text-xs text-zinc-400 dark:text-zinc-500 font-medium truncate max-w-xs">
            — {fileName}
          </span>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 text-[11px] font-medium">
            <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
              <span className="h-2 w-2 rounded-full bg-red-500" /> Removed
            </span>
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> Added
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Comparison"
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Aligned Columns Grid */}
      <div className="flex flex-1 min-h-0 divide-x divide-zinc-200 dark:divide-zinc-800 overflow-hidden">
        {/* Left Column (Base Content - vBase) */}
        <div
          ref={leftScrollRef}
          onScroll={handleLeftScroll}
          className="flex-1 overflow-auto bg-zinc-50/50 dark:bg-zinc-900/10 font-mono text-[11px] leading-6"
        >
          <div className="min-w-max p-4">
            {leftLines.map((line, idx) => (
              <div
                key={`left-${idx}`}
                className={cn(
                  "flex items-start select-none",
                  line.type === "removed" && "bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400 font-semibold",
                  line.type === "empty" && "bg-zinc-100 dark:bg-zinc-900 opacity-30 select-none pointer-events-none"
                )}
              >
                {/* Line number */}
                <div className="w-10 shrink-0 text-right pr-3 text-zinc-400 dark:text-zinc-600 border-r border-zinc-200 dark:border-zinc-800 mr-3">
                  {line.lineNumber ?? " "}
                </div>
                {/* Content */}
                <div className="whitespace-pre">{line.type === "empty" ? "\n" : line.content}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column (Target Content - vTarget) */}
        <div
          ref={rightScrollRef}
          onScroll={handleRightScroll}
          className="flex-1 overflow-auto bg-zinc-50/50 dark:bg-zinc-900/10 font-mono text-[11px] leading-6"
        >
          <div className="min-w-max p-4">
            {rightLines.map((line, idx) => (
              <div
                key={`right-${idx}`}
                className={cn(
                  "flex items-start select-none",
                  line.type === "added" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400 font-semibold",
                  line.type === "empty" && "bg-zinc-100 dark:bg-zinc-900 opacity-30 select-none pointer-events-none"
                )}
              >
                {/* Line number */}
                <div className="w-10 shrink-0 text-right pr-3 text-zinc-400 dark:text-zinc-600 border-r border-zinc-200 dark:border-zinc-800 mr-3">
                  {line.lineNumber ?? " "}
                </div>
                {/* Content */}
                <div className="whitespace-pre">{line.type === "empty" ? "\n" : line.content}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
