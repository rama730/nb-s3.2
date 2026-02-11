export type RunnerStream = "stdout" | "stderr" | "system";
export type RunnerSeverity = "error" | "warning" | "info";
export type RunnerSessionStatus = "queued" | "running" | "success" | "failed" | "canceled";

export interface RunnerProfileRecord {
    id: string;
    projectId: string;
    name: string;
    command: string;
    isDefault: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface RunnerLogRecord {
    id: string;
    sessionId: string;
    stream: RunnerStream;
    lineNumber: number;
    message: string;
    createdAt: Date;
}

export interface RunnerDiagnosticRecord {
    id: string;
    sessionId: string;
    projectId: string;
    nodeId: string | null;
    filePath: string | null;
    line: number | null;
    column: number | null;
    severity: RunnerSeverity;
    source: string | null;
    code: string | null;
    message: string;
    createdAt: Date;
}

export interface RunnerSessionRecord {
    id: string;
    projectId: string;
    profileId: string | null;
    startedBy: string | null;
    command: string;
    status: RunnerSessionStatus;
    exitCode: number | null;
    durationMs: number | null;
    errorCount: number;
    warningCount: number;
    startedAt: Date;
    finishedAt: Date | null;
    createdAt: Date;
}

export interface StartRunInput {
    projectId: string;
    command: string;
    profileId: string | null;
    startedBy: string;
}

export interface StartRunResult {
    status: RunnerSessionStatus;
    exitCode: number | null;
    logs: Array<{ stream: RunnerStream; message: string }>;
    diagnostics: Array<{
        nodeId: string | null;
        filePath: string | null;
        line: number | null;
        column: number | null;
        severity: RunnerSeverity;
        source: string | null;
        code: string | null;
        message: string;
    }>;
}

export type PersistedRunSessionDetail = {
    session: RunnerSessionRecord;
    logs: RunnerLogRecord[];
    diagnostics: RunnerDiagnosticRecord[];
};
