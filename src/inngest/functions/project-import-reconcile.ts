import { and, asc, eq, inArray, isNull, lt } from "drizzle-orm";

import { inngest } from "../client";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { clearSealedGithubTokenFromImportSource } from "@/lib/github/repo-security";
import { logger } from "@/lib/logger";

const STALE_RECONCILE_BATCH_SIZE = (() => {
  const raw = Number(process.env.PROJECT_IMPORT_RECONCILE_BATCH_SIZE || 100);
  if (!Number.isFinite(raw) || raw <= 0) return 100;
  return Math.min(500, Math.floor(raw));
})();

const STALE_RECONCILE_AGE_MINUTES = (() => {
  const raw = Number(process.env.PROJECT_IMPORT_STALE_MINUTES || 45);
  if (!Number.isFinite(raw) || raw < 10) return 45;
  return Math.min(24 * 60, Math.floor(raw));
})();

const IN_PROGRESS_SYNC_STATUSES: Array<(typeof projects.$inferSelect)["syncStatus"]> = [
  "pending",
  "cloning",
  "indexing",
];

type ImportSourceRecord = Record<string, unknown>;

function normalizeImportSource(raw: unknown): ImportSourceRecord {
  if (raw && typeof raw === "object") return raw as ImportSourceRecord;
  return { type: "scratch", metadata: {} };
}

function normalizeImportMetadata(source: ImportSourceRecord): ImportSourceRecord {
  const metadata = source.metadata;
  if (metadata && typeof metadata === "object") return metadata as ImportSourceRecord;
  return {};
}

function buildFailedImportSource(importSource: unknown, reason: string, nowIso: string): ImportSourceRecord {
  const source = normalizeImportSource(importSource);
  const sourceType = typeof source.type === "string" ? source.type : "scratch";
  const sourceWithoutTransientToken =
    sourceType === "github"
      ? (clearSealedGithubTokenFromImportSource(source) as ImportSourceRecord)
      : source;

  const metadata = normalizeImportMetadata(sourceWithoutTransientToken);
  const uploadSession = metadata.uploadSession;
  const nextUploadSession =
    uploadSession && typeof uploadSession === "object"
      ? {
          ...(uploadSession as Record<string, unknown>),
          status: "failed",
          lastActivityAt: nowIso,
        }
      : null;

  return {
    ...sourceWithoutTransientToken,
    metadata: {
      ...metadata,
      syncPhase: "failed",
      lastError: reason,
      staleReconciledAt: nowIso,
      ...(nextUploadSession ? { uploadSession: nextUploadSession } : {}),
    },
  };
}

export const projectImportStaleReconcile = inngest.createFunction(
  { id: "project-import-stale-reconcile", retries: 1 },
  { cron: "*/15 * * * *" },
  async () => {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - STALE_RECONCILE_AGE_MINUTES * 60_000);
    const nowIso = now.toISOString();

    const staleProjects = await db
      .select({
        id: projects.id,
        syncStatus: projects.syncStatus,
        importSource: projects.importSource,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .where(
        and(
          inArray(projects.syncStatus, IN_PROGRESS_SYNC_STATUSES),
          lt(projects.updatedAt, staleBefore),
          isNull(projects.deletedAt),
        ),
      )
      .orderBy(asc(projects.updatedAt))
      .limit(STALE_RECONCILE_BATCH_SIZE);

    if (staleProjects.length === 0) {
      return {
        scanned: 0,
        reconciled: 0,
        staleBefore: staleBefore.toISOString(),
      };
    }

    let reconciled = 0;
    let skippedRace = 0;
    let githubReconciled = 0;
    let uploadReconciled = 0;

    for (const project of staleProjects) {
      const source = normalizeImportSource(project.importSource);
      const sourceType = typeof source.type === "string" ? source.type : "scratch";
      const reason = `Reconciled stale ${String(project.syncStatus)} import state`;
      const nextImportSource = buildFailedImportSource(project.importSource, reason, nowIso);

      const updated = await db
        .update(projects)
        .set({
          syncStatus: "failed",
          importSource: nextImportSource as any,
          updatedAt: now,
        })
        .where(
          and(
            eq(projects.id, project.id),
            inArray(projects.syncStatus, IN_PROGRESS_SYNC_STATUSES),
          ),
        )
        .returning({ id: projects.id });

      if (updated.length === 0) {
        skippedRace += 1;
        continue;
      }

      reconciled += 1;
      if (sourceType === "github") githubReconciled += 1;
      if (sourceType === "upload") uploadReconciled += 1;
    }

    logger.metric("project.import.stale.reconcile", {
      scanned: staleProjects.length,
      reconciled,
      skippedRace,
      staleAgeMinutes: STALE_RECONCILE_AGE_MINUTES,
      githubReconciled,
      uploadReconciled,
    });

    return {
      scanned: staleProjects.length,
      reconciled,
      skippedRace,
      githubReconciled,
      uploadReconciled,
      staleBefore: staleBefore.toISOString(),
    };
  },
);
