"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Copy, Eraser, FileOutput, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { parseAnsi } from "./ansiParser";

interface OutputTabProps {
  projectId: string;
  /** Callback to re-run the active file */
  onRun?: () => void;
}

function isErrorLine(line: string): boolean {
  const lower = line.toLowerCase();
  return (
    line.includes("[error]") ||
    line.startsWith("  File ") ||
    lower.includes("traceback") ||
    lower.includes("error:") ||
    lower.includes("exception")
  );
}

function AnsiLine({ text, isError }: { text: string; isError?: boolean }) {
  const segments = parseAnsi(text);
  let content: React.ReactNode;
  if (segments.length === 1 && !segments[0].className) {
    content = <>{segments[0].text}</>;
  } else {
    content = (
      <>
        {segments.map((seg, i) =>
          seg.className ? (
            <span key={i} className={seg.className}>
              {seg.text}
            </span>
          ) : (
            <React.Fragment key={i}>{seg.text}</React.Fragment>
          )
        )}
      </>
    );
  }

  return isError ? <span className="text-red-600 dark:text-red-400">{content}</span> : content;
}

export function OutputTab({ projectId, onRun }: OutputTabProps) {
  const lines = useFilesWorkspaceStore((s) => s._get(projectId).ui.lastExecutionOutput);
  const lastExecutionSettingsHref = useFilesWorkspaceStore((s) => s._get(projectId).ui.lastExecutionSettingsHref ?? null);
  const outputMode = useFilesWorkspaceStore((s) => s._get(projectId).ui.outputFilterMode);
  
  const setLastExecutionOutput = useFilesWorkspaceStore((s) => s.setLastExecutionOutput);
  const setLastExecutionSettingsHref = useFilesWorkspaceStore((s) => s.setLastExecutionSettingsHref);
  const setOutputMode = useFilesWorkspaceStore((s) => s.setOutputFilterMode);

  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filteredLines = useMemo(() => {
    let result = lines;
    if (outputMode === "err") result = result.filter(isErrorLine);
    else if (outputMode === "out") result = result.filter((l) => !isErrorLine(l));
    return result;
  }, [lines, outputMode]);

  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const handleCopy = useCallback(async () => {
    if (!lines.length) return;
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  }, [lines]);

  const handleClear = useCallback(() => {
    setLastExecutionOutput(projectId, []);
    setLastExecutionSettingsHref(projectId, null);
  }, [projectId, setLastExecutionOutput, setLastExecutionSettingsHref]);

  return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-1 px-2 py-1 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <span className="text-xs text-zinc-500 mr-2">Output</span>
          
          {/* 3a: Output mode toggles */}
          {lines.length > 0 && (
            <div className="flex items-center bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded mr-auto">
              <button
                className={cn("px-2 py-0.5 text-[10px] rounded transition-colors font-medium", outputMode === "all" ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300")}
                onClick={() => setOutputMode(projectId, "all")}
              >
                All
              </button>
              <button
                className={cn("px-2 py-0.5 text-[10px] rounded transition-colors font-medium", outputMode === "out" ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300")}
                onClick={() => setOutputMode(projectId, "out")}
              >
                Output
              </button>
              <button
                className={cn("px-2 py-0.5 text-[10px] rounded transition-colors font-medium", outputMode === "err" ? "bg-white dark:bg-zinc-700 text-red-600 dark:text-red-400 shadow-sm" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300")}
                onClick={() => setOutputMode(projectId, "err")}
              >
                Errors
              </button>
            </div>
          )}

          <div className="ml-auto flex items-center gap-1">
          {lines.length > 0 && onRun && (
            <Button variant="ghost" size="sm" className="h-6 px-1.5 gap-1" onClick={onRun} title="Run again">
              <Play className="w-3 h-3" />
              Run
            </Button>
          )}
          {lines.length > 0 && lastExecutionSettingsHref && (
            <Link href={lastExecutionSettingsHref}>
              <Button variant="ghost" size="sm" className="h-6 px-1.5" title="Open Languages settings">
                Language
              </Button>
            </Link>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5"
            onClick={handleCopy}
            disabled={lines.length === 0}
            title="Copy all"
          >
            <Copy className="w-3 h-3" />
            {copied && <span className="text-[10px] ml-1">Copied</span>}
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={handleClear} disabled={lines.length === 0} title="Clear output">
            <Eraser className="w-3 h-3" />
          </Button>
          </div>
        </div>

        <div
          ref={containerRef}
          className="flex-1 overflow-auto font-mono text-xs px-3 py-2 whitespace-pre-wrap break-words bg-zinc-50 dark:bg-zinc-950"
        >
          {lines.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-500 text-center px-4">
              <FileOutput className="w-8 h-8 mb-2 opacity-40" />
              <span className="text-sm">No output</span>
              <span className="text-xs mt-1">
                Run a file with the Run button or use the Run tab.
                {" "}
                <Link href="/settings/languages" className="text-blue-600 dark:text-blue-400 hover:underline">
                  Configure languages
                </Link>
              </span>
            </div>
          ) : (
            filteredLines.map((line, i) => (
              <div key={i} className="leading-5 text-zinc-800 dark:text-zinc-200">
                <AnsiLine text={line} isError={isErrorLine(line)} />
              </div>
            ))
          )}
        </div>
      </div>
  );
}
