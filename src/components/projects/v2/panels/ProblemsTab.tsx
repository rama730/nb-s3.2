"use client";

import React, { useCallback, useMemo, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, File, Info, Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Problem } from "@/stores/files/types";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { useToast } from "@/components/ui-custom/Toast";

type Severity = "error" | "warning" | "info";

interface ProblemsTabProps {
  projectId: string;
  problems?: Problem[];
  onNavigateToFile?: (nodeId: string, line?: number) => void;
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

const SEVERITY_ICON: Record<Severity, React.ReactNode> = {
  error: <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />,
  warning: <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 shrink-0" />,
  info: <Info className="w-3.5 h-3.5 text-blue-500 shrink-0" />,
};

const SEVERITY_TEXT: Record<Severity, string> = {
  error: "text-red-500",
  warning: "text-yellow-500",
  info: "text-blue-500",
};

export function ProblemsTab({ projectId, problems = [], onNavigateToFile }: ProblemsTabProps) {
  const { showToast } = useToast();
  const [filters, setFilters] = useState<Record<Severity, boolean>>({
    error: true,
    warning: true,
    info: true,
  });
  const [fixingProblemIds, setFixingProblemIds] = useState<Record<string, boolean>>({});
  
  const applyQuickFix = useFilesWorkspaceStore((s) => s.applyQuickFix);

  const handleApplyQuickFix = useCallback(async (problem: Problem) => {
    if (!problem.fix || fixingProblemIds[problem.id]) return;
    setFixingProblemIds((prev) => ({ ...prev, [problem.id]: true }));
    try {
      await Promise.resolve(applyQuickFix(projectId, problem.id));
      showToast("Quick fix applied", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to apply quick fix";
      showToast(message, "error");
    } finally {
      setFixingProblemIds((prev) => {
        const next = { ...prev };
        delete next[problem.id];
        return next;
      });
    }
  }, [applyQuickFix, fixingProblemIds, projectId, showToast]);

  const toggleFilter = (sev: Severity) =>
    setFilters((prev) => ({ ...prev, [sev]: !prev[sev] }));

  const sorted = useMemo(
    () =>
      [...problems]
        .filter((p) => filters[p.severity])
        .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
    [problems, filters]
  );

  const grouped = useMemo(() => {
    const map = new Map<string, Problem[]>();
    for (const p of sorted) {
      const key = p.filePath || "workspace";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [sorted]);

  const counts = useMemo(() => {
    const c = { error: 0, warning: 0, info: 0 };
    for (const p of problems) c[p.severity]++;
    return c;
  }, [problems]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <Button
          variant={filters.error ? "secondary" : "ghost"}
          size="sm"
          className="h-6 px-2 text-[11px] gap-1"
          onClick={() => toggleFilter("error")}
        >
          <AlertCircle className="w-3 h-3 text-red-500" />
          Errors ({counts.error})
        </Button>
        <Button
          variant={filters.warning ? "secondary" : "ghost"}
          size="sm"
          className="h-6 px-2 text-[11px] gap-1"
          onClick={() => toggleFilter("warning")}
        >
          <AlertTriangle className="w-3 h-3 text-yellow-500" />
          Warnings ({counts.warning})
        </Button>
        <Button
          variant={filters.info ? "secondary" : "ghost"}
          size="sm"
          className="h-6 px-2 text-[11px] gap-1"
          onClick={() => toggleFilter("info")}
        >
          <Info className="w-3 h-3 text-blue-500" />
          Info ({counts.info})
        </Button>
      </div>

      <div className="flex-1 overflow-auto bg-zinc-50 dark:bg-zinc-950">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500">
            <CheckCircle2 className="w-8 h-8 mb-2 text-emerald-500 opacity-60" />
            <span className="text-sm">No problems detected</span>
          </div>
        ) : (
          <div className="py-1">
            {Array.from(grouped.entries()).map(([filePath, fileProblems]) => (
              <div key={filePath}>
                <div className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100/60 dark:bg-zinc-900/60 sticky top-0">
                  <File className="w-3 h-3 shrink-0" />
                  <span className="truncate">{filePath}</span>
                  <span className="text-zinc-400 ml-auto shrink-0">{fileProblems.length}</span>
                </div>
                {fileProblems.map((problem) => (
                  <div
                    key={problem.id}
                    className="w-full flex items-start gap-2 px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors group"
                  >
                    <button
                      className="flex items-start gap-2 flex-1 text-left min-w-0"
                      onClick={() => onNavigateToFile?.(problem.nodeId, problem.line)}
                    >
                      <div className="mt-0.5">{SEVERITY_ICON[problem.severity]}</div>
                      <div className="min-w-0 flex-1">
                        <span className="text-xs text-zinc-800 dark:text-zinc-200">{problem.message}</span>
                        {problem.source && (
                          <span className="text-[10px] text-zinc-400 ml-1.5">[{problem.source}]</span>
                        )}
                      </div>
                    </button>
                    
                    {problem.fix && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1.5 text-[10px] gap-1 opacity-0 group-hover:opacity-100 shrink-0 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/40"
                        onClick={() => void handleApplyQuickFix(problem)}
                        title={problem.fix.label}
                        disabled={!!fixingProblemIds[problem.id]}
                      >
                        {fixingProblemIds[problem.id] ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Applying
                          </>
                        ) : (
                          <>
                            <Wand2 className="w-3 h-3" />
                            Fix
                          </>
                        )}
                      </Button>
                    )}

                    {problem.line != null && (
                      <span className={cn("text-[11px] shrink-0 tabular-nums self-center text-right ml-1", SEVERITY_TEXT[problem.severity])}>
                        Ln {problem.line}
                        {problem.column != null ? `:${problem.column}` : ""}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function useProblemsCount(problems: Problem[] = []): number {
  return useMemo(() => problems.filter((p) => p.severity === "error").length, [problems]);
}
