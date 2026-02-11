"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Copy, Eraser, FileWarning, PlayCircle, RefreshCw, TerminalSquare, WrapText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PersistedRunSessionDetail, RunnerSessionRecord } from "@/lib/runner/contracts";

type RunnerPanelTab = "terminal" | "problems" | "runs";

interface RunnerPanelProps {
    open: boolean;
    loading: boolean;
    sessions: RunnerSessionRecord[];
    detail: PersistedRunSessionDetail | null;
    onToggleOpen: () => void;
    onSelectSession: (sessionId: string) => void;
    onOpenDiagnostic: (nodeId: string | null, filePath?: string | null) => void;
    onRefreshRuns: () => void;
    storageKey: string;
}

function statusTone(status: RunnerSessionRecord["status"]) {
    if (status === "success") return "text-emerald-500";
    if (status === "failed") return "text-red-500";
    if (status === "running") return "text-indigo-500";
    return "text-zinc-500";
}

export default function RunnerPanel({
    open,
    loading,
    sessions,
    detail,
    onToggleOpen,
    onSelectSession,
    onOpenDiagnostic,
    onRefreshRuns,
    storageKey,
}: RunnerPanelProps) {
    const [tab, setTab] = useState<RunnerPanelTab>("terminal");
    const [clearedSessionIds, setClearedSessionIds] = useState<Record<string, boolean>>({});
    const [hiddenSessionIds, setHiddenSessionIds] = useState<Record<string, boolean>>({});
    const [autoScroll, setAutoScroll] = useState(true);
    const [wrapLines, setWrapLines] = useState(false);
    const [copied, setCopied] = useState(false);
    const terminalRef = useRef<HTMLDivElement | null>(null);
    const diagnostics = detail?.diagnostics ?? [];
    const logs = detail?.logs ?? [];
    const activeSessionHidden = detail?.session ? !!hiddenSessionIds[detail.session.id] : false;
    const visibleLogs = detail?.session && (clearedSessionIds[detail.session.id] || activeSessionHidden) ? [] : logs;
    const visibleDiagnostics = activeSessionHidden ? [] : diagnostics;
    const visibleSessions = sessions.filter((session) => !hiddenSessionIds[session.id]);

    const headerSummary = useMemo(() => {
        if (!detail?.session) return "No run selected";
        if (activeSessionHidden) return "Session hidden";
        const session = detail.session;
        return `${session.status.toUpperCase()} · errors ${session.errorCount} · warnings ${session.warningCount}${session.durationMs ? ` · ${session.durationMs}ms` : ""}`;
    }, [activeSessionHidden, detail]);

    useEffect(() => {
        try {
            const raw = localStorage.getItem(storageKey);
            if (!raw) return;
            const parsed = JSON.parse(raw) as { tab?: RunnerPanelTab; autoScroll?: boolean; wrapLines?: boolean };
            if (parsed.tab) setTab(parsed.tab);
            if (typeof parsed.autoScroll === "boolean") setAutoScroll(parsed.autoScroll);
            if (typeof parsed.wrapLines === "boolean") setWrapLines(parsed.wrapLines);
        } catch {}
    }, [storageKey]);

    useEffect(() => {
        try {
            localStorage.setItem(
                storageKey,
                JSON.stringify({
                    tab,
                    autoScroll,
                    wrapLines,
                }),
            );
        } catch {}
    }, [autoScroll, storageKey, tab, wrapLines]);

    useEffect(() => {
        if (!open || tab !== "terminal" || !autoScroll) return;
        const element = terminalRef.current;
        if (!element) return;
        element.scrollTop = element.scrollHeight;
    }, [autoScroll, open, tab, visibleLogs.length]);

    if (!open) return null;

    return (
        <div className="border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/80 backdrop-blur">
            <div className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                    <TerminalSquare className="w-4 h-4 text-zinc-500" />
                    <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Runner</span>
                    <span className="text-xs text-zinc-500 truncate">{headerSummary}</span>
                </div>
                <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onRefreshRuns} title="Refresh runs">
                    <RefreshCw className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onToggleOpen} title="Close runner">
                    <X className="w-4 h-4" />
                </Button>
                </div>
            </div>

            <div className="h-[260px] border-t border-zinc-200 dark:border-zinc-800 flex flex-col">
                    <div className="flex items-center gap-1 px-2 py-1 border-b border-zinc-200 dark:border-zinc-800">
                        <Button
                            variant={tab === "terminal" ? "secondary" : "ghost"}
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setTab("terminal")}
                        >
                            Terminal
                        </Button>
                        <Button
                            variant={tab === "problems" ? "secondary" : "ghost"}
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setTab("problems")}
                        >
                            Problems ({diagnostics.length})
                        </Button>
                        <Button
                            variant={tab === "runs" ? "secondary" : "ghost"}
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setTab("runs")}
                        >
                            Runs ({sessions.length})
                        </Button>
                        {tab === "terminal" ? (
                            <div className="ml-auto flex items-center gap-1">
                                <Button
                                    variant={autoScroll ? "secondary" : "ghost"}
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => setAutoScroll((prev) => !prev)}
                                    title="Toggle auto scroll"
                                >
                                    Auto
                                </Button>
                                <Button
                                    variant={wrapLines ? "secondary" : "ghost"}
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => setWrapLines((prev) => !prev)}
                                    title="Toggle wrap"
                                >
                                    <WrapText className="w-3.5 h-3.5 mr-1.5" />
                                    Wrap
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    onClick={async () => {
                                        if (!visibleLogs.length) return;
                                        try {
                                            await navigator.clipboard.writeText(visibleLogs.map((line) => line.message).join("\n"));
                                            setCopied(true);
                                            setTimeout(() => setCopied(false), 1200);
                                        } catch {}
                                    }}
                                    disabled={visibleLogs.length === 0}
                                    title="Copy output"
                                >
                                    <Copy className="w-3.5 h-3.5 mr-1.5" />
                                    {copied ? "Copied" : "Copy"}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => {
                                        if (!detail?.session) return;
                                        setClearedSessionIds((prev) => ({ ...prev, [detail.session.id]: true }));
                                    }}
                                    disabled={!detail?.session}
                                >
                                    <Eraser className="w-3.5 h-3.5 mr-1.5" />
                                    Clear
                                </Button>
                            </div>
                        ) : null}
                        {tab === "runs" ? (
                            <div className="ml-auto flex items-center gap-1">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    onClick={() =>
                                        setHiddenSessionIds((prev) => {
                                            const next = { ...prev };
                                            for (const session of sessions) next[session.id] = true;
                                            return next;
                                        })
                                    }
                                    disabled={sessions.length === 0}
                                >
                                    Hide all
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => setHiddenSessionIds({})}
                                    disabled={Object.keys(hiddenSessionIds).length === 0}
                                >
                                    Reset
                                </Button>
                            </div>
                        ) : null}
                        {loading ? <span className="text-xs text-zinc-500 ml-2">Running…</span> : null}
                    </div>

                    <div className="flex-1 overflow-auto">
                        {tab === "terminal" ? (
                            <div
                                ref={terminalRef}
                                className={cn(
                                    "font-mono text-xs px-3 py-2 space-y-1 overflow-auto h-full",
                                    wrapLines ? "whitespace-pre-wrap break-words" : "whitespace-pre"
                                )}
                            >
                                {visibleLogs.length === 0 ? (
                                    <div className="text-zinc-500">No logs yet.</div>
                                ) : (
                                    visibleLogs.map((log) => (
                                        <div
                                            key={log.id}
                                            className={cn(
                                                log.stream === "stderr" ? "text-red-500" : log.stream === "system" ? "text-indigo-500" : "text-zinc-800 dark:text-zinc-200",
                                            )}
                                        >
                                            {log.message}
                                        </div>
                                    ))
                                )}
                            </div>
                        ) : null}

                        {tab === "problems" ? (
                            <div className="px-2 py-2 space-y-1">
                                {visibleDiagnostics.length === 0 ? (
                                    <div className="px-2 py-1 text-sm text-zinc-500">No diagnostics.</div>
                                ) : (
                                    visibleDiagnostics.map((diag) => (
                                        <button
                                            key={diag.id}
                                            className="w-full text-left rounded-md px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
                                            onClick={() => onOpenDiagnostic(diag.nodeId, diag.filePath)}
                                        >
                                            <div className="flex items-center gap-2 text-xs">
                                                {diag.severity === "error" ? (
                                                    <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                                                ) : (
                                                    <FileWarning className="w-3.5 h-3.5 text-yellow-500" />
                                                )}
                                                <span className={cn("font-medium", diag.severity === "error" ? "text-red-500" : "text-yellow-500")}>
                                                    {diag.severity.toUpperCase()}
                                                </span>
                                                <span className="text-zinc-500 truncate">
                                                    {diag.filePath || "workspace"}{diag.line ? `:${diag.line}` : ""}
                                                </span>
                                            </div>
                                            <div className="text-xs text-zinc-700 dark:text-zinc-300 pl-5 truncate">{diag.message}</div>
                                        </button>
                                    ))
                                )}
                            </div>
                        ) : null}

                        {tab === "runs" ? (
                            <div className="px-2 py-2 space-y-1">
                                {visibleSessions.length === 0 ? (
                                    <div className="px-2 py-1 text-sm text-zinc-500">No runs yet.</div>
                                ) : (
                                    visibleSessions.map((session) => (
                                        <button
                                            key={session.id}
                                            className={cn(
                                                "w-full rounded-md px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors",
                                                detail?.session.id === session.id && "bg-zinc-100 dark:bg-zinc-900",
                                            )}
                                            onClick={() => onSelectSession(session.id)}
                                        >
                                            <div className="flex items-center gap-2 text-xs">
                                                <PlayCircle className={cn("w-3.5 h-3.5", statusTone(session.status))} />
                                                <span className="text-zinc-800 dark:text-zinc-200 font-medium truncate">{session.command}</span>
                                                <span className={cn("ml-auto", statusTone(session.status))}>{session.status}</span>
                                            </div>
                                            <div className="text-[11px] text-zinc-500 mt-0.5">
                                                {new Date(session.startedAt).toLocaleString()} · errors {session.errorCount} · warnings {session.warningCount}
                                            </div>
                                        </button>
                                    ))
                                )}
                            </div>
                        ) : null}
                    </div>
                </div>
        </div>
    );
}
