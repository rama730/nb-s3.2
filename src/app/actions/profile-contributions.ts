"use server";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import {
  profileAuditEvents,
  profileProjectContributions,
  profiles,
} from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import {
  contributionMonthToDate,
  profileContributionBatchSchema,
  type ProfileContributionBatch,
} from "@/lib/profile/contribution-contract";
import { markProfileCollaborationSummaryStale } from "@/lib/profile/collaboration";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { syncContributionSkillsBatch } from "@/lib/skills/service";
import { createClient } from "@/lib/supabase/server";

export type SaveProfileContributionsResult =
  | {
      success: true;
      idempotent: boolean;
      contributions: Array<{ id: string; version: number }>;
    }
  | {
      success: false;
      error: string;
      errorCode: "UNAUTHORIZED" | "RATE_LIMITED" | "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "SAVE_FAILED";
      contributionId?: string;
      mutationIndex?: number;
    };

type ExistingContribution = {
  id: string;
  projectId: string | null;
  externalKey: string | null;
  version: number;
  visibility: "public" | "private";
  summary: string | null;
  repositoryUrl: string | null;
  projectUrl: string | null;
  projectTitle: string | null;
  roleTitle: string | null;
};

class ContributionSaveError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR",
    message: string,
    readonly contributionId?: string,
    readonly mutationIndex?: number,
  ) {
    super(message);
  }
}

function auditSnapshot(value: ExistingContribution | undefined) {
  if (!value) return null;
  return {
    id: value.id,
    kind: value.projectId ? "platform" : "external",
    visibility: value.visibility,
    version: value.version,
    projectTitle: value.projectTitle,
    roleTitle: value.roleTitle,
  };
}

function isDuplicateBatchError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "23505"
    && "constraint" in error
    && error.constraint === "profile_audit_events_contribution_batch_key_unique",
  );
}

export async function saveProfileContributionsAction(
  input: ProfileContributionBatch,
): Promise<SaveProfileContributionsResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Unauthorized", errorCode: "UNAUTHORIZED" };
  }

  const rate = await consumeRateLimit(`profile:contributions:${user.id}`, 20, 60);
  if (!rate.allowed) {
    return {
      success: false,
      error: "Too many contribution updates. Please wait and try again.",
      errorCode: "RATE_LIMITED",
    };
  }

  const parsed = profileContributionBatchSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const mutationIndex = issue?.path[0] === "mutations" && typeof issue.path[1] === "number"
      ? issue.path[1]
      : undefined;
    const inputMutations = Array.isArray((input as Partial<ProfileContributionBatch> | null)?.mutations)
      ? input.mutations
      : [];
    const invalidMutation = mutationIndex === undefined ? undefined : inputMutations[mutationIndex];
    const contributionId = invalidMutation && "contributionId" in invalidMutation
      ? invalidMutation.contributionId
      : undefined;
    return {
      success: false,
      error: issue?.message ?? "Invalid contribution update",
      errorCode: "VALIDATION_ERROR",
      ...(contributionId ? { contributionId } : {}),
      ...(mutationIndex === undefined ? {} : { mutationIndex }),
    };
  }

  const batch = parsed.data;
  const previousBatch = await db
    .select({ id: profileAuditEvents.id })
    .from(profileAuditEvents)
    .where(and(
      eq(profileAuditEvents.userId, user.id),
      eq(profileAuditEvents.eventType, "profile_contribution_batch_saved"),
      sql`${profileAuditEvents.metadata}->>'idempotencyKey' = ${batch.idempotencyKey}`,
    ))
    .limit(1);
  if (previousBatch.length > 0) {
    return { success: true, idempotent: true, contributions: [] };
  }

  try {
    const result = await db.transaction(async (tx) => {
      const contributionIds = batch.mutations.flatMap((mutation) =>
        "contributionId" in mutation && mutation.contributionId ? [mutation.contributionId] : [],
      );
      const existingRows = contributionIds.length > 0
        ? await tx
            .select({
              id: profileProjectContributions.id,
              projectId: profileProjectContributions.projectId,
              externalKey: profileProjectContributions.externalKey,
              version: profileProjectContributions.version,
              visibility: profileProjectContributions.visibility,
              summary: profileProjectContributions.summary,
              repositoryUrl: profileProjectContributions.repositoryUrl,
              projectUrl: profileProjectContributions.projectUrl,
              projectTitle: profileProjectContributions.projectTitle,
              roleTitle: profileProjectContributions.roleTitle,
            })
            .from(profileProjectContributions)
            .where(and(
              eq(profileProjectContributions.profileId, user.id),
              inArray(profileProjectContributions.id, contributionIds),
              isNull(profileProjectContributions.deletedAt),
            ))
        : [];
      const existingById = new Map(existingRows.map((row) => [row.id, row as ExistingContribution]));
      const changed: Array<{ id: string; version: number }> = [];
      const skillsToSync: Array<{ contributionId: string; labels: readonly string[] }> = [];
      const auditChanges: Array<Record<string, unknown>> = [];
      const now = new Date();

      for (const [mutationIndex, mutation] of batch.mutations.entries()) {
        if (mutation.kind === "external-delete") {
          const current = existingById.get(mutation.contributionId);
          if (!current || current.projectId) {
            throw new ContributionSaveError("NOT_FOUND", "External contribution was not found", mutation.contributionId, mutationIndex);
          }
          const deleted = await tx
            .update(profileProjectContributions)
            .set({ deletedAt: now, updatedAt: now, version: sql`${profileProjectContributions.version} + 1` })
            .where(and(
              eq(profileProjectContributions.id, current.id),
              eq(profileProjectContributions.profileId, user.id),
              eq(profileProjectContributions.version, mutation.expectedVersion),
              isNull(profileProjectContributions.deletedAt),
              isNull(profileProjectContributions.projectId),
            ))
            .returning({ id: profileProjectContributions.id, version: profileProjectContributions.version });
          if (!deleted[0]) {
            throw new ContributionSaveError("CONFLICT", "Contribution changed elsewhere. Refresh and try again.", mutation.contributionId, mutationIndex);
          }
          changed.push(deleted[0]);
          auditChanges.push({ action: "delete", previous: auditSnapshot(current), next: null });
          continue;
        }

        if (mutation.kind === "platform") {
          const current = existingById.get(mutation.contributionId);
          if (!current || !current.projectId) {
            throw new ContributionSaveError("NOT_FOUND", "Platform contribution was not found", mutation.contributionId, mutationIndex);
          }
          const updated = await tx
            .update(profileProjectContributions)
            .set({
              visibility: mutation.visibility,
              summary: mutation.summary,
              repositoryUrl: mutation.repositoryUrl,
              skills: mutation.skills,
              startedAt: contributionMonthToDate(mutation.dates.startedAt),
              endedAt: contributionMonthToDate(mutation.dates.endedAt),
              updatedAt: now,
              version: sql`${profileProjectContributions.version} + 1`,
            })
            .where(and(
              eq(profileProjectContributions.id, current.id),
              eq(profileProjectContributions.profileId, user.id),
              eq(profileProjectContributions.version, mutation.expectedVersion),
              isNull(profileProjectContributions.deletedAt),
              sql`${profileProjectContributions.projectId} IS NOT NULL`,
            ))
            .returning({ id: profileProjectContributions.id, version: profileProjectContributions.version });
          if (!updated[0]) {
            throw new ContributionSaveError("CONFLICT", "Contribution changed elsewhere. Refresh and try again.", mutation.contributionId, mutationIndex);
          }
          changed.push(updated[0]);
          skillsToSync.push({ contributionId: current.id, labels: mutation.skills });
          auditChanges.push({
            action: "update",
            previous: auditSnapshot(current),
            next: { id: current.id, kind: "platform", visibility: mutation.visibility, version: updated[0].version },
          });
          continue;
        }

        if (mutation.contributionId) {
          const current = existingById.get(mutation.contributionId);
          if (!current || current.projectId || current.externalKey !== mutation.externalKey) {
            throw new ContributionSaveError("NOT_FOUND", "External contribution was not found", mutation.contributionId, mutationIndex);
          }
          const updated = await tx
            .update(profileProjectContributions)
            .set({
              projectTitle: mutation.projectTitle,
              projectUrl: mutation.projectUrl,
              repositoryUrl: mutation.repositoryUrl,
              roleTitle: mutation.roleTitle,
              summary: mutation.summary,
              skills: mutation.skills,
              startedAt: contributionMonthToDate(mutation.dates.startedAt),
              endedAt: contributionMonthToDate(mutation.dates.endedAt),
              visibility: mutation.visibility,
              updatedAt: now,
              version: sql`${profileProjectContributions.version} + 1`,
            })
            .where(and(
              eq(profileProjectContributions.id, current.id),
              eq(profileProjectContributions.profileId, user.id),
              eq(profileProjectContributions.version, mutation.expectedVersion!),
              isNull(profileProjectContributions.deletedAt),
              isNull(profileProjectContributions.projectId),
            ))
            .returning({ id: profileProjectContributions.id, version: profileProjectContributions.version });
          if (!updated[0]) {
            throw new ContributionSaveError("CONFLICT", "Contribution changed elsewhere. Refresh and try again.", mutation.contributionId, mutationIndex);
          }
          changed.push(updated[0]);
          skillsToSync.push({ contributionId: current.id, labels: mutation.skills });
          auditChanges.push({
            action: "update",
            previous: auditSnapshot(current),
            next: { id: current.id, kind: "external", visibility: mutation.visibility, version: updated[0].version },
          });
        } else {
          const inserted = await tx
            .insert(profileProjectContributions)
            .values({
              profileId: user.id,
              projectId: null,
              externalKey: mutation.externalKey,
              projectTitle: mutation.projectTitle,
              projectUrl: mutation.projectUrl,
              repositoryUrl: mutation.repositoryUrl,
              source: "manual",
              roleKind: "contributor",
              roleTitle: mutation.roleTitle,
              summary: mutation.summary,
              skills: mutation.skills,
              startedAt: contributionMonthToDate(mutation.dates.startedAt),
              endedAt: contributionMonthToDate(mutation.dates.endedAt),
              visibility: mutation.visibility,
              version: 1,
              updatedAt: now,
            })
            .returning({ id: profileProjectContributions.id, version: profileProjectContributions.version });
          const created = inserted[0]!;
          changed.push(created);
          skillsToSync.push({ contributionId: created.id, labels: mutation.skills });
          auditChanges.push({
            action: "create",
            previous: null,
            next: { id: created.id, kind: "external", visibility: mutation.visibility, version: created.version },
          });
        }
      }

      const resolvedByContribution = await syncContributionSkillsBatch(tx, skillsToSync, user.id);
      for (const [contributionId, resolvedSkills] of resolvedByContribution) {
        await tx
          .update(profileProjectContributions)
          .set({ skills: resolvedSkills.map((skill) => skill.name) })
          .where(and(
            eq(profileProjectContributions.id, contributionId),
            eq(profileProjectContributions.profileId, user.id),
            isNull(profileProjectContributions.deletedAt),
          ));
      }

      await markProfileCollaborationSummaryStale(user.id, tx);
      await tx.insert(profileAuditEvents).values({
        userId: user.id,
        eventType: "profile_contribution_batch_saved",
        previousValue: null,
        nextValue: { changedCount: changed.length },
        metadata: {
          idempotencyKey: batch.idempotencyKey,
          mutationCount: batch.mutations.length,
          changes: auditChanges,
        },
      });
      return changed;
    });

    const [profile] = await db
      .select({ username: profiles.username })
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1);
    revalidatePath("/profile");
    if (profile?.username) revalidatePath(`/u/${profile.username}`);
    logger.metric("profile.contributions.save", {
      userId: user.id,
      mutationCount: batch.mutations.length,
      success: true,
    });
    return { success: true, idempotent: false, contributions: result };
  } catch (error) {
    if (isDuplicateBatchError(error)) {
      return { success: true, idempotent: true, contributions: [] };
    }
    if (error instanceof ContributionSaveError) {
      return {
        success: false,
        error: error.message,
        errorCode: error.code,
        ...(error.contributionId ? { contributionId: error.contributionId } : {}),
        ...(error.mutationIndex === undefined ? {} : { mutationIndex: error.mutationIndex }),
      };
    }
    logger.error("profile.contributions.save_failed", {
      module: "profile",
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: "Could not save contributions", errorCode: "SAVE_FAILED" };
  }
}
