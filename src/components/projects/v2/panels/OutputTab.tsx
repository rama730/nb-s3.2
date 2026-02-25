"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Copy, Download, Eraser, FileOutput, Lock, Play, Search, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

function AnsiLine({ text, isError, searchQuery }: { text: string; isError?: boolean; searchQuery?: string }) {
  const segments = parseAnsi(text);
  const plainText = segments.map((s) => s.text).join("");

  let content: React.ReactNode;
  if (searchQuery && searchQuery.trim()) {
    const q = searchQuery.trim();
    const parts = plainText.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
    content = (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === q.toLowerCase() ? (
            <mark key={i} className="bg-yellow-200 dark:bg-yellow-800/60 rounded px-0.5">
              {part}
            </mark>
          ) : (
            <React.Fragment key={i}>{part}</React.Fragment>
          )
        )}
      </>
    );
  } else if (segments.length === 1 && !segments[0].className) {
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
  const setLastExecutionOutput = useFilesWorkspaceStore((s) => s.setLastExecutionOutput);
  const setLastExecutionSettingsHref = useFilesWorkspaceStore((s) => s.setLastExecutionSettingsHref);
  const [scrollLock, setScrollLock] = useState(false);
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const filteredLines = useMemo(() => {
    if (!searchQuery.trim()) return lines;
    const q = searchQuery.trim().toLowerCase();
    return lines.filter((line) => line.toLowerCase().includes(q));
  }, [lines, searchQuery]);

  useEffect(() => {
    if (scrollLock) return;
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, scrollLock]);

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

  const handleExport = useCallback(() => {
    if (!lines.length) return;
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `output-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [lines]);

  return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-1 px-2 py-1 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <span className="text-xs text-zinc-500 mr-auto">Output</span>
          {lines.length > 0 && onRun && (
            <Button variant="ghost" size="sm" className="h-6 px-1.5 gap-1" onClick={onRun} title="Run again">
              <Play className="w-3 h-3" />
              Run again
            </Button>
          )}
          {lines.length > 0 && lastExecutionSettingsHref && (
            <Link href={lastExecutionSettingsHref}>
              <Button variant="ghost" size="sm" className="h-6 px-1.5" title="Open Languages settings">
                Open Languages
              </Button>
            </Link>
          )}
          <div className="flex items-center gap-0.5">
            <Search className="w-3 h-3 text-zinc-400" />
            <Input
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-6 w-24 px-1.5 text-[11px]"
            />
          </div>
          <Button
            variant={scrollLock ? "secondary" : "ghost"}
            size="sm"
            className="h-6 px-1.5"
            onClick={() => setScrollLock((prev) => !prev)}
            title={scrollLock ? "Unlock auto-scroll" : "Lock scroll position"}
          >
            {scrollLock ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
          </Button>
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
          <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={handleExport} disabled={lines.length === 0} title="Export to file">
            <Download className="w-3 h-3" />
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={handleClear} disabled={lines.length === 0} title="Clear output">
            <Eraser className="w-3 h-3" />
          </Button>
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
                Run a file with the Run button or use the Terminal tab.
                {" "}
                <Link href="/settings/languages" className="text-blue-600 dark:text-blue-400 hover:underline">
                  Configure languages
                </Link>
              </span>
            </div>
          ) : (
            filteredLines.map((line, i) => (
              <div key={i} className="leading-5 text-zinc-800 dark:text-zinc-200">
                <AnsiLine text={line} isError={isErrorLine(line)} searchQuery={searchQuery} />
              </div>
            ))
          )}
        </div>
      </div>
  );
}
