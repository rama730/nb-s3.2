import { inngest } from "../client";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { githubSyncRuns } from "@/lib/db/schema";
import { runReviewedGitHubSync } from "@/lib/github/sync-runner";
import { cleanupReviewedSyncSnapshots } from "@/lib/github/sync-service";
import {
  verifySignedJobRequestToken,
  createSignedJobRequestToken,
} from "@/lib/security/job-request";
import { deleteExpiredFileLeases } from "@/lib/files/file-lock-service";
import { cleanupExpiredUploadIntents } from "@/lib/upload/upload-intents";

const concurrency: [{ limit: number; key: string }, { limit: number }] = [
  { limit: 1, key: "event.data.projectId" },
  { limit: 4 },
];
export const gitPush = inngest.createFunction(
  { id: "git-push", retries: 0, concurrency },
  { event: "git/push" },
  async ({ event, step }) => {
    const { projectId, userId, runId, jobSignature } = event.data;
    if (
      !runId ||
      !verifySignedJobRequestToken(jobSignature, {
        kind: "git/push",
        actorId: userId,
        subjectId: runId,
      }).ok
    )
      throw new Error("A signed, reviewed push operation is required");
    return step.run("execute-reviewed-publication", () =>
      runReviewedGitHubSync(runId, userId, projectId),
    );
  },
);
export const gitPull = inngest.createFunction(
  { id: "git-pull", retries: 0, concurrency },
  { event: "git/pull" },
  async ({ event, step }) => {
    const { projectId, userId, runId, jobSignature } = event.data;
    if (
      !runId ||
      !verifySignedJobRequestToken(jobSignature, {
        kind: "git/pull",
        actorId: userId,
        subjectId: runId,
      }).ok
    )
      throw new Error("A signed, reviewed pull operation is required");
    return step.run("execute-reviewed-pull", () =>
      runReviewedGitHubSync(runId, userId, projectId),
    );
  },
);
export const gitSyncRecovery = inngest.createFunction(
  { id: "git-sync-recovery", concurrency: 1 },
  { cron: "*/2 * * * *" },
  async ({ step }) =>
    step.run("recover-and-dispatch-sync", async () => {
      await db
        .update(githubSyncRuns)
        .set({
          status: "cancelled",
          credential: null,
          stage: "Review expired — compare again",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(githubSyncRuns.status, "review"),
            lt(githubSyncRuns.createdAt, new Date(Date.now() - 60 * 60_000)),
          ),
        );
      await cleanupReviewedSyncSnapshots();
      await db
        .update(githubSyncRuns)
        .set({
          status: "failed",
          stage: "Worker interrupted — review and retry",
          error:
            "The worker lease expired. Previously applied files and remote commit identity have been retained.",
          leaseId: null,
          leaseExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(githubSyncRuns.status, "running"),
            lt(githubSyncRuns.leaseExpiresAt, new Date()),
          ),
        );
      await db
        .update(githubSyncRuns)
        .set({ credential: null })
        .where(
          and(
            inArray(githubSyncRuns.status, [
              "review",
              "failed",
              "needs_review",
              "cancelled",
              "completed",
            ]),
            lt(githubSyncRuns.createdAt, new Date(Date.now() - 60 * 60_000)),
          ),
        );
      const queued = await db
        .select()
        .from(githubSyncRuns)
        .where(
          and(
            eq(githubSyncRuns.status, "queued"),
            sql`${githubSyncRuns.updatedAt} < now() - interval '30 seconds'`,
          ),
        )
        .limit(50);
      for (const run of queued)
        await inngest.send({
          name: run.manifest.direction === "push" ? "git/push" : "git/pull",
          id: `sync-recover:${run.id}:${Math.floor(Date.now() / 120_000)}`,
          data: {
            projectId: run.projectId,
            userId: run.actorId,
            runId: run.id,
            commitMessage: run.manifest.message,
            jobSignature: createSignedJobRequestToken({
              kind: `git/${run.manifest.direction}`,
              actorId: run.actorId,
              subjectId: run.id,
              ttlSeconds: 3600,
            }),
          },
        });
      return { dispatched: queued.length };
    }),
);
export const uploadIntentCleanup = inngest.createFunction(
  { id: "upload-intent-cleanup", concurrency: 1 },
  { cron: "*/15 * * * *" },
  async ({ step }) =>
    step.run("cleanup-expired-intents", cleanupExpiredUploadIntents),
);
export const lockCleanup = inngest.createFunction(
  { id: "lock-cleanup" },
  { cron: "*/5 * * * *" },
  async () => {
    let deleted = 0;
    for (let batch = 0; batch < 10; batch++) {
      const count = await deleteExpiredFileLeases(1000);
      deleted += count;
      if (count < 1000) break;
    }
    return { cleaned: true, deleted };
  },
);
