"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Eraser, Play, Plus, TerminalSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import type { TerminalSession } from "@/stores/files/types";
import { runFileInBrowser, isSupportedCommand } from "@/lib/runner/runFile";
import { parseAnsi } from "./ansiParser";

interface TerminalTabProps {
  projectId: string;
  canEdit: boolean;
  activeFilePath?: string;
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
  const inner =
    segments.length === 1 && !segments[0].className ? (
      <>{segments[0].text}</>
    ) : (
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
  return isError ? <span className="text-red-600 dark:text-red-400">{inner}</span> : inner;
}

export function TerminalTab({ projectId, canEdit, activeFilePath }: TerminalTabProps) {
  const [inputValue, setInputValue] = useState("");
  const [copied, setCopied] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  const sessions = useFilesWorkspaceStore((s) => s._get(projectId).terminal.sessions);
  const activeSessionId = useFilesWorkspaceStore((s) => s._get(projectId).terminal.activeSessionId);
  const addSession = useFilesWorkspaceStore((s) => s.addTerminalSession);
  const removeSession = useFilesWorkspaceStore((s) => s.removeTerminalSession);
  const setActiveSession = useFilesWorkspaceStore((s) => s.setActiveTerminalSession);
  const appendOutput = useFilesWorkspaceStore((s) => s.appendTerminalOutput);
  const clearOutput = useFilesWorkspaceStore((s) => s.clearTerminalOutput);
  const setRunning = useFilesWorkspaceStore((s) => s.setTerminalRunning);
  const setLastExecutionOutput = useFilesWorkspaceStore((s) => s.setLastExecutionOutput);
  const setLastExecutionSettingsHref = useFilesWorkspaceStore((s) => s.setLastExecutionSettingsHref);
  const appendDebugOutput = useFilesWorkspaceStore((s) => s.appendDebugOutput);
  const setStdinInputText = useFilesWorkspaceStore((s) => s.setStdinInputText);
  const pushCommandToHistory = useFilesWorkspaceStore((s) => s.pushCommandToHistory);
  const commandHistory = useFilesWorkspaceStore((s) => s._get(projectId).ui.commandHistory ?? []);

  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isSearchingHistory, setIsSearchingHistory] = useState(false);
  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mainInputRef = useRef<HTMLInputElement>(null);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeSession?.output.length]);

  const createSession = useCallback(
    (command: string) => {
      const id = `term-${Date.now()}`;
      const isExecutable = isSupportedCommand(command);
      const session: TerminalSession = {
        id,
        label: command,
        output: [`$ ${command}`, ""],
        isRunning: isExecutable,
        startedAt: Date.now(),
      };
      addSession(projectId, session);

      if (!isExecutable) {
        appendOutput(projectId, id, "Waiting for output. Type a command like: python main.py or node index.js");
        setRunning(projectId, id, false);
        return;
      }

      void (async () => {
        const stdinText = useFilesWorkspaceStore.getState()._get(projectId).ui.stdinInputText;
        const stdinLines = stdinText.split("\n").map((s) => s.trim()).filter(Boolean);
        const result = await runFileInBrowser(projectId, command, activeFilePath, {
          stdinLines: stdinLines.length > 0 ? stdinLines : undefined,
        });
        if (result.logs) {
          for (let i = 1; i < result.logs.length; i++) {
            appendOutput(projectId, id, result.logs[i] ?? "");
          }
          setLastExecutionOutput(projectId, result.logs);
          setLastExecutionSettingsHref(projectId, result.success ? null : (result.settingsHref ?? null));
          appendDebugOutput(projectId, result.logs);
          if (result.success) setStdinInputText(projectId, "");
        } else {
          const errMsg = result.error ?? "Execution failed";
          appendOutput(projectId, id, errMsg ? `[error] ${errMsg}` : "");
          setLastExecutionOutput(projectId, [`$ ${command}`, errMsg ? `[error] ${errMsg}` : ""]);
          setLastExecutionSettingsHref(projectId, result.settingsHref ?? null);
          appendDebugOutput(projectId, [`$ ${command}`, errMsg ? `[error] ${errMsg}` : ""]);
        }
        setRunning(projectId, id, false);
      })();
    },
    [
      projectId,
      addSession,
      appendOutput,
      setRunning,
      setLastExecutionOutput,
      setLastExecutionSettingsHref,
      appendDebugOutput,
      setStdinInputText,
      activeFilePath,
    ]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const cmd = isSearchingHistory && historySearchQuery.trim()
        ? (commandHistory.filter((c) => c.includes(historySearchQuery)).pop() ?? "")
        : inputValue.trim();
      if (!cmd) return;
      pushCommandToHistory(projectId, cmd);
      createSession(cmd);
      setInputValue("");
      setHistoryIndex(-1);
      setIsSearchingHistory(false);
      setHistorySearchQuery("");
      setTimeout(() => mainInputRef.current?.focus(), 0);
    },
    [inputValue, createSession, pushCommandToHistory, projectId, isSearchingHistory, historySearchQuery, commandHistory]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.ctrlKey && e.key === "r") {
        e.preventDefault();
        setIsSearchingHistory(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
        return;
      }

      if (commandHistory.length === 0) return;
      if (e.key === "ArrowUp") {
        e.preventDefault();
        const next = historyIndex === -1 ? 0 : Math.min(historyIndex + 1, commandHistory.length - 1);
        if (next >= 0) {
          setHistoryIndex(next);
          setInputValue(commandHistory[next] ?? "");
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (historyIndex <= 0) {
          setHistoryIndex(-1);
          setInputValue("");
          return;
        }
        const next = historyIndex - 1;
        setHistoryIndex(next);
        setInputValue(commandHistory[next] ?? "");
      }
    },
    [commandHistory, historyIndex]
  );

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.ctrlKey && e.key === "r") {
        e.preventDefault(); // Ignore subsequent Ctrl+R in search mode
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setIsSearchingHistory(false);
        setHistorySearchQuery("");
        setTimeout(() => mainInputRef.current?.focus(), 0);
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const cmd = historySearchQuery
          ? (commandHistory.filter((c) => c.includes(historySearchQuery)).pop() ?? "")
          : inputValue.trim();
        if (!cmd) {
           setIsSearchingHistory(false);
           setHistorySearchQuery("");
           setTimeout(() => mainInputRef.current?.focus(), 0);
           return;
        }
        pushCommandToHistory(projectId, cmd);
        createSession(cmd);
        setInputValue("");
        setHistoryIndex(-1);
        setIsSearchingHistory(false);
        setHistorySearchQuery("");
        setTimeout(() => mainInputRef.current?.focus(), 0);
      }
    },
    [historySearchQuery, commandHistory, inputValue, projectId, pushCommandToHistory, createSession]
  );

  const handleCopy = useCallback(async () => {
    if (!activeSession) return;
    try {
      await navigator.clipboard.writeText(activeSession.output.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  }, [activeSession]);

  return (
    <div className="flex flex-col h-full">
      {/* Session tabs + preset commands */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        {sessions.map((s) => (
          <button
            key={s.id}
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors",
              s.id === activeSessionId
                ? "bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900"
            )}
            onClick={() => setActiveSession(projectId, s.id)}
          >
            <TerminalSquare className="w-3 h-3" />
            <span className="max-w-[100px] truncate">{s.label}</span>
            {s.isRunning && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
            <span
              role="button"
              className="ml-0.5 rounded hover:bg-zinc-300 dark:hover:bg-zinc-700 p-0.5"
              onClick={(e) => {
                e.stopPropagation();
                removeSession(projectId, s.id);
              }}
            >
              <X className="w-2.5 h-2.5" />
            </span>
          </button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={() => createSession("bash")}
          title="New session"
        >
          <Plus className="w-3 h-3" />
        </Button>
        <div className="ml-auto flex items-center gap-1">
          {activeSession && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5"
                onClick={handleCopy}
                title="Copy output"
              >
                <Copy className="w-3 h-3" />
                {copied && <span className="text-[10px] ml-1">Copied</span>}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5"
                onClick={() => clearOutput(projectId, activeSession.id)}
                title="Clear output"
              >
                <Eraser className="w-3 h-3" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Output area */}
      <div
        ref={outputRef}
        className="flex-1 overflow-auto font-mono text-xs px-3 py-2 whitespace-pre-wrap break-words bg-zinc-50 dark:bg-zinc-950"
      >
        {!activeSession ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500">
            <TerminalSquare className="w-8 h-8 mb-2 opacity-40" />
            <span className="text-sm">No terminal session</span>
            <span className="text-xs mt-1">Press + or run a preset command to start</span>
          </div>
        ) : activeSession.output.length === 0 ? (
          <div className="text-zinc-500">Waiting for output…</div>
        ) : (
          activeSession.output.map((line, i) => (
            <div key={i} className="leading-5 text-zinc-800 dark:text-zinc-200">
              <AnsiLine text={line} isError={isErrorLine(line)} />
            </div>
          ))
        )}
      </div>

      {/* Command input */}
      {canEdit && (
        <div className="relative border-t border-zinc-200 dark:border-zinc-800 shrink-0">
          {/* Reverse Search Overlay */}
          {isSearchingHistory && (
            <div className="absolute bottom-full left-0 w-full bg-blue-50 dark:bg-blue-950/40 border-t border-zinc-200 dark:border-zinc-800 px-3 py-1.5 flex flex-col gap-1 shadow-[0_-4px_10px_rgba(0,0,0,0.05)] z-10">
              <div className="flex items-center text-xs text-blue-600 dark:text-blue-400 font-mono">
                <span>(reverse-i-search)`</span>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={historySearchQuery}
                  onChange={(e) => setHistorySearchQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  className="bg-transparent outline-none w-24 border-b border-blue-300 dark:border-blue-700 mx-1 px-0.5 placeholder:text-blue-300/50"
                  placeholder="type..."
                />
                <span>`:</span>
              </div>
              <div className="text-xs text-zinc-600 dark:text-zinc-300 font-mono truncate pl-4 border-l-2 border-blue-400/50 ml-1">
                {historySearchQuery ? (
                  commandHistory.filter((c) => c.includes(historySearchQuery)).pop() || <span className="text-zinc-400 italic">No matches</span>
                ) : (
                  <span className="text-zinc-400 italic">Type to search history</span>
                )}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex items-center">
            <span className="pl-3 pr-1 text-xs text-emerald-500 font-mono select-none">$</span>
            <input
              ref={mainInputRef}
              type="text"
              data-testid="terminal-command-input"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a command… (Ctrl+R to search history)"
              className="flex-1 bg-transparent text-xs font-mono px-2 py-2 outline-none text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400"
            />
            {(() => {
              let matchedCmd = "";
              if (isSearchingHistory && historySearchQuery.trim()) {
                matchedCmd = commandHistory.filter((c) => c.includes(historySearchQuery)).pop() || "";
              }
              const isDisabled = !inputValue.trim() && (!isSearchingHistory || !historySearchQuery.trim() || !matchedCmd);
              return (
                <Button type="submit" variant="ghost" size="sm" className="h-7 px-2 mr-1" disabled={isDisabled}>
                  <Play className="w-3 h-3" />
                </Button>
              );
            })()}
          </form>
        </div>
      )}
    </div>
  );
}
