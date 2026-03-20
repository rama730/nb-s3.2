"use client";

import React, { useCallback, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { runFileInBrowser } from "@/lib/runner/runFile";
import { parseStderrToProblems } from "@/app/actions/parseStderrToProblems";

interface RunTabProps {
  projectId: string;
  canEdit: boolean;
  activeFilePath?: string;
  activeFileContent?: string;
}

function getSuggestedCommand(activeFilePath?: string): string {
  if (!activeFilePath) return "";
  const ext = activeFilePath.slice(activeFilePath.lastIndexOf(".")).toLowerCase();
  switch (ext) {
    case ".py":
      return `python ${activeFilePath}`;
    case ".js":
    case ".mjs":
      return `node ${activeFilePath}`;
    case ".sql":
      return `sql ${activeFilePath}`;
    case ".ts":
    case ".tsx":
      return `ts-node ${activeFilePath}`;
    case ".java":
      return `java ${activeFilePath}`;
    case ".c":
      return `gcc ${activeFilePath}`;
    case ".cpp":
    case ".cc":
      return `g++ ${activeFilePath}`;
    default:
      return "";
  }
}

function fileLikelyNeedsInput(activeFilePath?: string, activeFileContent?: string): boolean {
  if (!activeFilePath || !activeFileContent) return false;
  const content = activeFileContent;
  if (activeFilePath.endsWith(".py")) return /input\s*\(/.test(content);
  if (activeFilePath.endsWith(".java")) return /new\s+Scanner\s*\(/.test(content);
  if (activeFilePath.endsWith(".js") || activeFilePath.endsWith(".ts")) return /readline|prompt/.test(content);
  if (activeFilePath.endsWith(".cpp") || activeFilePath.endsWith(".c") || activeFilePath.endsWith(".cc")) {
    return /cin\s*>>|scanf/.test(content);
  }
  return false;
}

export function RunTab({ projectId, canEdit, activeFilePath, activeFileContent }: RunTabProps) {
  const [customCommand, setCustomCommand] = useState("");
  const [showCustomCommand, setShowCustomCommand] = useState(false);
  const [showProgramInput, setShowProgramInput] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  const stdinInputText = useFilesWorkspaceStore((s) => s._get(projectId).ui.stdinInputText);
  const commandHistory = useFilesWorkspaceStore((s) => s._get(projectId).ui.commandHistory ?? []);
  const setLastExecutionOutput = useFilesWorkspaceStore((s) => s.setLastExecutionOutput);
  const setLastExecutionSettingsHref = useFilesWorkspaceStore((s) => s.setLastExecutionSettingsHref);
  const setStdinInputText = useFilesWorkspaceStore((s) => s.setStdinInputText);
  const pushCommandToHistory = useFilesWorkspaceStore((s) => s.pushCommandToHistory);
  const setProblems = useFilesWorkspaceStore((s) => s.setProblems);
  const setBottomPanelTab = useFilesWorkspaceStore((s) => s.setBottomPanelTab);

  const suggestedCommand = useMemo(() => getSuggestedCommand(activeFilePath), [activeFilePath]);
  const needsInput = useMemo(
    () => fileLikelyNeedsInput(activeFilePath, activeFileContent),
    [activeFilePath, activeFileContent]
  );

  const executeCommand = useCallback(
    async (command: string) => {
      const trimmed = command.trim();
      if (!trimmed || isRunning) return;

      setIsRunning(true);
      pushCommandToHistory(projectId, trimmed);
      setBottomPanelTab(projectId, "output");

      try {
        const stdinLines = stdinInputText
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s !== "");

        const result = await runFileInBrowser(projectId, trimmed, activeFilePath, {
          stdinLines: stdinLines.length > 0 ? stdinLines : undefined,
        });

        const logs = result.success ? [...result.logs, "Code execution successful."] : result.logs;
        setLastExecutionOutput(projectId, logs);
        setLastExecutionSettingsHref(projectId, result.success ? null : (result.settingsHref ?? null));

        if (result.success) {
          setStdinInputText(projectId, "");
          return;
        }

        if (result.stderr) {
          const execProblems = await parseStderrToProblems(projectId, result.stderr);
          const existing = useFilesWorkspaceStore.getState()._get(projectId).ui.problems ?? [];
          const merged = [...existing.filter((p) => p.source !== "execution"), ...execProblems];
          setProblems(projectId, merged);
          if (execProblems.length > 0) {
            setBottomPanelTab(projectId, "problems");
          }
        }
      } finally {
        setIsRunning(false);
      }
    },
    [
      activeFilePath,
      isRunning,
      projectId,
      pushCommandToHistory,
      setBottomPanelTab,
      setLastExecutionOutput,
      setLastExecutionSettingsHref,
      setProblems,
      setStdinInputText,
      stdinInputText,
    ]
  );

  const recentCommands = commandHistory.slice(0, 5);

  return (
    <div className="flex h-full flex-col bg-zinc-50 dark:bg-zinc-950">
      <div className="border-b border-zinc-200 px-3 py-3 dark:border-zinc-800">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Run code</div>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Run the current file or use a supported custom command.
            </div>
          </div>
          {suggestedCommand ? (
            <Button
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => void executeCommand(suggestedCommand)}
              disabled={!canEdit || isRunning}
            >
              <Play className="h-3.5 w-3.5" />
              Run current file
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-3 py-3">
        <div className="space-y-3">
          <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
            <button
              className="flex w-full items-center justify-between text-left"
              onClick={() => setShowCustomCommand((prev) => !prev)}
              type="button"
            >
              <div>
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Custom command</div>
                <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Supported: python, node, sql, ts-node, java, gcc, g++.
                </div>
              </div>
              {showCustomCommand ? (
                <ChevronDown className="h-4 w-4 text-zinc-500" />
              ) : (
                <ChevronRight className="h-4 w-4 text-zinc-500" />
              )}
            </button>

            {showCustomCommand ? (
              <div className="mt-3 space-y-2">
                <input
                  type="text"
                  data-testid="run-command-input"
                  value={customCommand}
                  onChange={(e) => setCustomCommand(e.target.value)}
                  placeholder={suggestedCommand || "python src/main.py"}
                  className={cn(
                    "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm",
                    "text-zinc-900 outline-none placeholder:text-zinc-400",
                    "focus:border-blue-500 focus:ring-1 focus:ring-blue-500",
                    "dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                  )}
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => void executeCommand(customCommand || suggestedCommand)}
                    disabled={!canEdit || isRunning || !(customCommand.trim() || suggestedCommand)}
                  >
                    <Play className="h-3.5 w-3.5" />
                    Run command
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Program input</div>
                <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Enter one value per line if the program asks for input.
                </div>
              </div>
              {needsInput && !showProgramInput ? (
                <button
                  type="button"
                  className="rounded-md border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  onClick={() => setShowProgramInput(true)}
                >
                  Add input
                </button>
              ) : (
                <button
                  type="button"
                  className="text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  onClick={() => setShowProgramInput((prev) => !prev)}
                >
                  {showProgramInput ? "Hide" : "Show"}
                </button>
              )}
            </div>

            {needsInput && !showProgramInput ? (
              <div className="mt-3 rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
                This file may require input.
              </div>
            ) : null}

            {showProgramInput ? (
              <div className="mt-3">
                <textarea
                  value={stdinInputText}
                  onChange={(e) => setStdinInputText(projectId, e.target.value)}
                  placeholder="42&#10;17"
                  rows={4}
                  className={cn(
                    "w-full resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-mono",
                    "text-zinc-900 outline-none placeholder:text-zinc-400",
                    "focus:border-blue-500 focus:ring-1 focus:ring-blue-500",
                    "dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                  )}
                />
              </div>
            ) : null}
          </div>

          {recentCommands.length > 0 ? (
            <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Recent commands</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {recentCommands.map((command) => (
                  <button
                    key={command}
                    type="button"
                    className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-mono text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    onClick={() => {
                      setShowCustomCommand(true);
                      setCustomCommand(command);
                    }}
                  >
                    {command}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
