"use server";

import { db } from "@/lib/db";
import {
    projectRunDiagnostics,
    projectRunLogs,
    projectRunProfiles,
    projectRunSessions,
} from "@/lib/db/schema";
import {
    and,
    asc,
    desc,
    eq,
    sql,
} from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { getProjectAccessById } from "@/lib/data/project-access";
import { runLocalAnalyzer } from "@/lib/runner/local-analyzer";
import type {
    PersistedRunSessionDetail,
    RunnerProfileRecord,
    RunnerSessionRecord,
    StartRunInput,
} from "@/lib/runner/contracts";

const DEFAULT_RUN_PROFILES = [
    { name: "Analyze", command: "analyze", isDefault: true },
    { name: "Build", command: "build", isDefault: false },
    { name: "Test", command: "test", isDefault: false },
    { name: "Lint", command: "lint", isDefault: false },
];

const MAX_RUN_PROFILES = 20;
const MAX_RUN_LOG_LINES = 1200;
const MAX_RUN_DIAGNOSTICS = 1200;
const MAX_COMMAND_CHARS = 160;
const RUN_STALE_TIMEOUT_MS = 20 * 60 * 1000;
const SEVERITY_RANK: Record<string, number> = { error: 0, warning: 1, info: 2 };

function getErrorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
}

async function getCurrentUserId() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id || null;
}

async function assertProjectRunnerAccess(projectId: string, requireWrite = false) {
    const userId = await getCurrentUserId();
    if (!userId) throw new Error("Not authenticated");
    const access = await getProjectAccessById(projectId, userId);
    if (!access.project || !access.canRead || (requireWrite && !access.canWrite)) {
        throw new Error("Forbidden");
    }
    return { userId, access };
}

function normalizeCommand(command: string) {
    return (command || "").trim().slice(0, MAX_COMMAND_CHARS);
}

async function ensureDefaultProfiles(projectId: string, userId: string) {
    const existing = await db
        .select({ id: projectRunProfiles.id })
        .from(projectRunProfiles)
        .where(eq(projectRunProfiles.projectId, projectId))
        .limit(1);
    if (existing.length > 0) return;

    await db.insert(projectRunProfiles).values(
        DEFAULT_RUN_PROFILES.map((profile) => ({
            projectId,
            name: profile.name,
            command: profile.command,
            isDefault: profile.isDefault,
            createdBy: userId,
        })),
    );
}

export async function getProjectRunProfilesAction(projectId: string) {
    try {
        const { userId } = await assertProjectRunnerAccess(projectId, false);
        await ensureDefaultProfiles(projectId, userId);

        const profiles = await db
            .select({
                id: projectRunProfiles.id,
                projectId: projectRunProfiles.projectId,
                name: projectRunProfiles.name,
                command: projectRunProfiles.command,
                isDefault: projectRunProfiles.isDefault,
                createdAt: projectRunProfiles.createdAt,
                updatedAt: projectRunProfiles.updatedAt,
            })
            .from(projectRunProfiles)
            .where(eq(projectRunProfiles.projectId, projectId))
            .orderBy(desc(projectRunProfiles.isDefault), asc(projectRunProfiles.name))
            .limit(MAX_RUN_PROFILES);

        return { success: true as const, profiles };
    } catch (error: unknown) {
        return { success: false as const, error: getErrorMessage(error, "Failed to load run profiles"), profiles: [] as RunnerProfileRecord[] };
    }
}

export async function upsertProjectRunProfileAction(
    projectId: string,
    input: { id?: string; name: string; command: string; isDefault?: boolean },
) {
    try {
        const { userId } = await assertProjectRunnerAccess(projectId, true);
        const normalizedName = (input.name || "").trim();
        const normalizedCommand = normalizeCommand(input.command || "");
        if (!normalizedName) return { success: false as const, error: "Profile name is required" };
        if (!normalizedCommand) return { success: false as const, error: "Command is required" };

        let targetProfileId = input.id || "";

        if (input.id) {
            const [updated] = await db
                .update(projectRunProfiles)
                .set({
                    name: normalizedName,
                    command: normalizedCommand,
                    isDefault: !!input.isDefault,
                    updatedAt: new Date(),
                })
                .where(and(eq(projectRunProfiles.id, input.id), eq(projectRunProfiles.projectId, projectId)))
                .returning({ id: projectRunProfiles.id });
            if (!updated) return { success: false as const, error: "Profile not found" };
            targetProfileId = updated.id;
        } else {
            const countRows = await db
                .select({ id: projectRunProfiles.id })
                .from(projectRunProfiles)
                .where(eq(projectRunProfiles.projectId, projectId))
                .limit(MAX_RUN_PROFILES + 1);
            if (countRows.length >= MAX_RUN_PROFILES) {
                return { success: false as const, error: `Maximum ${MAX_RUN_PROFILES} profiles allowed` };
            }

            const [created] = await db.insert(projectRunProfiles).values({
                projectId,
                name: normalizedName,
                command: normalizedCommand,
                isDefault: !!input.isDefault,
                createdBy: userId,
            }).returning({ id: projectRunProfiles.id });
            targetProfileId = created.id;
        }

        if (input.isDefault) {
            await db
                .update(projectRunProfiles)
                .set({ isDefault: false, updatedAt: new Date() })
                .where(eq(projectRunProfiles.projectId, projectId));
            await db
                .update(projectRunProfiles)
                .set({ isDefault: true, updatedAt: new Date() })
                .where(and(eq(projectRunProfiles.projectId, projectId), eq(projectRunProfiles.id, targetProfileId)));
        }

        return getProjectRunProfilesAction(projectId);
    } catch (error: unknown) {
        return { success: false as const, error: getErrorMessage(error, "Failed to save run profile"), profiles: [] as RunnerProfileRecord[] };
    }
}

export async function deleteProjectRunProfileAction(projectId: string, profileId: string) {
    try {
        await assertProjectRunnerAccess(projectId, true);
        await db
            .delete(projectRunProfiles)
            .where(and(eq(projectRunProfiles.id, profileId), eq(projectRunProfiles.projectId, projectId)));
        return getProjectRunProfilesAction(projectId);
    } catch (error: unknown) {
        return { success: false as const, error: getErrorMessage(error, "Failed to delete run profile"), profiles: [] as RunnerProfileRecord[] };
    }
}

export async function listProjectRunSessionsAction(projectId: string, limit = 30) {
    try {
        await assertProjectRunnerAccess(projectId, false);
        const safeLimit = Math.max(1, Math.min(limit, 100));
        const sessions = await db
            .select({
                id: projectRunSessions.id,
                projectId: projectRunSessions.projectId,
                profileId: projectRunSessions.profileId,
                startedBy: projectRunSessions.startedBy,
                command: projectRunSessions.command,
                status: projectRunSessions.status,
                exitCode: projectRunSessions.exitCode,
                durationMs: projectRunSessions.durationMs,
                errorCount: projectRunSessions.errorCount,
                warningCount: projectRunSessions.warningCount,
                startedAt: projectRunSessions.startedAt,
                finishedAt: projectRunSessions.finishedAt,
                createdAt: projectRunSessions.createdAt,
            })
            .from(projectRunSessions)
            .where(eq(projectRunSessions.projectId, projectId))
            .orderBy(desc(projectRunSessions.startedAt))
            .limit(safeLimit);

        return { success: true as const, sessions: sessions as RunnerSessionRecord[] };
    } catch (error: unknown) {
        return { success: false as const, error: getErrorMessage(error, "Failed to load run sessions"), sessions: [] as RunnerSessionRecord[] };
    }
}

export async function getProjectRunSessionDetailAction(projectId: string, sessionId: string) {
    try {
        await assertProjectRunnerAccess(projectId, false);
        const [session] = await db
            .select({
                id: projectRunSessions.id,
                projectId: projectRunSessions.projectId,
                profileId: projectRunSessions.profileId,
                startedBy: projectRunSessions.startedBy,
                command: projectRunSessions.command,
                status: projectRunSessions.status,
                exitCode: projectRunSessions.exitCode,
                durationMs: projectRunSessions.durationMs,
                errorCount: projectRunSessions.errorCount,
                warningCount: projectRunSessions.warningCount,
                startedAt: projectRunSessions.startedAt,
                finishedAt: projectRunSessions.finishedAt,
                createdAt: projectRunSessions.createdAt,
            })
            .from(projectRunSessions)
            .where(and(eq(projectRunSessions.id, sessionId), eq(projectRunSessions.projectId, projectId)))
            .limit(1);
        if (!session) return { success: false as const, error: "Run session not found" };

        const [logs, diagnostics] = await Promise.all([
            db
                .select({
                    id: projectRunLogs.id,
                    sessionId: projectRunLogs.sessionId,
                    stream: projectRunLogs.stream,
                    lineNumber: projectRunLogs.lineNumber,
                    message: projectRunLogs.message,
                    createdAt: projectRunLogs.createdAt,
                })
                .from(projectRunLogs)
                .where(eq(projectRunLogs.sessionId, sessionId))
                .orderBy(asc(projectRunLogs.lineNumber))
                .limit(MAX_RUN_LOG_LINES),
            db
                .select({
                    id: projectRunDiagnostics.id,
                    sessionId: projectRunDiagnostics.sessionId,
                    projectId: projectRunDiagnostics.projectId,
                    nodeId: projectRunDiagnostics.nodeId,
                    filePath: projectRunDiagnostics.filePath,
                    line: projectRunDiagnostics.line,
                    column: projectRunDiagnostics.column,
                    severity: projectRunDiagnostics.severity,
                    source: projectRunDiagnostics.source,
                    code: projectRunDiagnostics.code,
                    message: projectRunDiagnostics.message,
                    createdAt: projectRunDiagnostics.createdAt,
                })
                .from(projectRunDiagnostics)
                .where(eq(projectRunDiagnostics.sessionId, sessionId))
                .orderBy(asc(projectRunDiagnostics.createdAt))
                .limit(MAX_RUN_DIAGNOSTICS),
        ]);

        const diagnosticKeys = new Set<string>();
        const dedupedDiagnostics = diagnostics
            .filter((diag) => !!diag.message)
            .filter((diag) => {
                const key = [
                    diag.nodeId || "",
                    diag.filePath || "",
                    diag.line ?? "",
                    diag.column ?? "",
                    diag.code || "",
                    diag.message,
                ].join("|");
                if (diagnosticKeys.has(key)) return false;
                diagnosticKeys.add(key);
                return true;
            })
            .sort((a, b) => {
                const rankA = SEVERITY_RANK[a.severity] ?? 99;
                const rankB = SEVERITY_RANK[b.severity] ?? 99;
                if (rankA !== rankB) return rankA - rankB;
                if ((a.filePath || "") !== (b.filePath || "")) return (a.filePath || "").localeCompare(b.filePath || "");
                return (a.line || 0) - (b.line || 0);
            });

        return {
            success: true as const,
            detail: {
                session: session as RunnerSessionRecord,
                logs,
                diagnostics: dedupedDiagnostics,
            } satisfies PersistedRunSessionDetail,
        };
    } catch (error: unknown) {
        return { success: false as const, error: getErrorMessage(error, "Failed to load run detail") };
    }
}

export async function runProjectProfileAction(
    projectId: string,
    input: { profileId?: string; command?: string },
) {
    try {
        const { userId } = await assertProjectRunnerAccess(projectId, true);
        await ensureDefaultProfiles(projectId, userId);

        let selectedProfileId: string | null = null;
        let command = normalizeCommand(input.command || "");

        if (input.profileId) {
            const [profile] = await db
                .select({
                    id: projectRunProfiles.id,
                    command: projectRunProfiles.command,
                })
                .from(projectRunProfiles)
                .where(and(eq(projectRunProfiles.id, input.profileId), eq(projectRunProfiles.projectId, projectId)))
                .limit(1);
            if (!profile) return { success: false as const, error: "Run profile not found" };
            selectedProfileId = profile.id;
            command = normalizeCommand(profile.command);
        } else if (!command) {
            const [defaultProfile] = await db
                .select({
                    id: projectRunProfiles.id,
                    command: projectRunProfiles.command,
                })
                .from(projectRunProfiles)
                .where(and(eq(projectRunProfiles.projectId, projectId), eq(projectRunProfiles.isDefault, true)))
                .orderBy(desc(projectRunProfiles.updatedAt))
                .limit(1);
            if (defaultProfile) {
                selectedProfileId = defaultProfile.id;
                command = normalizeCommand(defaultProfile.command);
            }
        }

        if (!command) {
            return { success: false as const, error: "Command is required" };
        }

        const sessionCreate = await db.transaction(async (tx) => {
            await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`project-run:${projectId}`}))`);

            const [latestRunning] = await tx
                .select({
                    id: projectRunSessions.id,
                    startedAt: projectRunSessions.startedAt,
                })
                .from(projectRunSessions)
                .where(
                    and(
                        eq(projectRunSessions.projectId, projectId),
                        sql`${projectRunSessions.status} in ('queued', 'running')`
                    )
                )
                .orderBy(desc(projectRunSessions.startedAt))
                .limit(1);

            if (latestRunning) {
                const ageMs = Date.now() - new Date(latestRunning.startedAt).getTime();
                if (ageMs < RUN_STALE_TIMEOUT_MS) {
                    return { blockedBySessionId: latestRunning.id };
                }
                // Mark stale run as failed so a new run can proceed.
                await tx
                    .update(projectRunSessions)
                    .set({
                        status: "failed",
                        exitCode: 124,
                        finishedAt: new Date(),
                        durationMs: Math.max(1, ageMs),
                    })
                    .where(eq(projectRunSessions.id, latestRunning.id));
            }

            const [session] = await tx
                .insert(projectRunSessions)
                .values({
                    projectId,
                    profileId: selectedProfileId,
                    startedBy: userId,
                    command,
                    status: "running",
                })
                .returning({
                    id: projectRunSessions.id,
                    startedAt: projectRunSessions.startedAt,
                });

            return { session };
        });

        if ("blockedBySessionId" in sessionCreate) {
            return {
                success: false as const,
                error: "A run is already in progress for this project. Open Runner to follow it.",
                sessionId: sessionCreate.blockedBySessionId,
            };
        }

        const session = sessionCreate.session;

        const startedAtMs = new Date(session.startedAt).getTime();
        const result = await runLocalAnalyzer({
            projectId,
            profileId: selectedProfileId,
            startedBy: userId,
            command,
        } satisfies StartRunInput);

        const finishedAt = new Date();
        const durationMs = Math.max(1, finishedAt.getTime() - startedAtMs);
        const logsToInsert = result.logs.slice(0, MAX_RUN_LOG_LINES);
        const diagnosticsToInsert = result.diagnostics.slice(0, MAX_RUN_DIAGNOSTICS);

        if (logsToInsert.length > 0) {
            await db.insert(projectRunLogs).values(
                logsToInsert.map((log, index) => ({
                    sessionId: session.id,
                    projectId,
                    stream: log.stream,
                    lineNumber: index + 1,
                    message: log.message,
                })),
            );
        }

        if (diagnosticsToInsert.length > 0) {
            await db.insert(projectRunDiagnostics).values(
                diagnosticsToInsert.map((diagnostic) => ({
                    sessionId: session.id,
                    projectId,
                    nodeId: diagnostic.nodeId,
                    filePath: diagnostic.filePath,
                    line: diagnostic.line,
                    column: diagnostic.column,
                    severity: diagnostic.severity,
                    source: diagnostic.source,
                    code: diagnostic.code,
                    message: diagnostic.message,
                })),
            );
        }

        await db
            .update(projectRunSessions)
            .set({
                status: result.status,
                exitCode: result.exitCode,
                durationMs,
                errorCount: diagnosticsToInsert.filter((item) => item.severity === "error").length,
                warningCount: diagnosticsToInsert.filter((item) => item.severity === "warning").length,
                finishedAt,
            })
            .where(eq(projectRunSessions.id, session.id));

        const detailRes = await getProjectRunSessionDetailAction(projectId, session.id);
        if (!detailRes.success) return { success: false as const, error: "Run finished but details failed to load" };
        return { success: true as const, detail: detailRes.detail };
    } catch (error: unknown) {
        return { success: false as const, error: getErrorMessage(error, "Failed to run project profile") };
    }
}

