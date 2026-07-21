import { z } from "zod";

import { isSafeHttpUrl } from "@/lib/security/urls";

export const PROFILE_CONTRIBUTION_LIMITS = {
  batchSize: 50,
  title: 120,
  role: 120,
  summary: 2_000,
  skillCount: 20,
  skillLabel: 80,
  url: 2_048,
  externalKey: 100,
} as const;

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM");
const nullableMonthSchema = z.union([monthSchema, z.literal(""), z.null()]).optional()
  .transform((value) => value || null);
const nullableUrlSchema = z.union([
  z.string().trim().max(PROFILE_CONTRIBUTION_LIMITS.url),
  z.null(),
]).optional().transform((value) => value || null).refine(
  (value) => value === null || isSafeHttpUrl(value),
  "URL must use http(s) and point to a public host",
);
const nullableText = (max: number) => z.union([
  z.string().trim().max(max),
  z.null(),
]).optional().transform((value) => value || null);
const skillsSchema = z.array(
  z.string().trim().min(1).max(PROFILE_CONTRIBUTION_LIMITS.skillLabel),
).max(PROFILE_CONTRIBUTION_LIMITS.skillCount).transform((values) => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
});

const datedMutationSchema = z.object({
  startedAt: nullableMonthSchema,
  endedAt: nullableMonthSchema,
}).superRefine((value, context) => {
  if (value.startedAt && value.endedAt && value.endedAt < value.startedAt) {
    context.addIssue({
      code: "custom",
      path: ["endedAt"],
      message: "End month cannot be earlier than start month",
    });
  }
});

const platformMutationSchema = z.object({
  kind: z.literal("platform"),
  contributionId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  visibility: z.enum(["public", "private"]),
  summary: nullableText(PROFILE_CONTRIBUTION_LIMITS.summary),
  repositoryUrl: nullableUrlSchema,
  skills: skillsSchema,
  dates: datedMutationSchema,
}).strict();

const externalMutationSchema = z.object({
  kind: z.literal("external"),
  contributionId: z.string().uuid().optional(),
  externalKey: z.string().trim().min(1).max(PROFILE_CONTRIBUTION_LIMITS.externalKey)
    .regex(/^[a-zA-Z0-9:_-]+$/, "External key contains unsupported characters"),
  expectedVersion: z.number().int().positive().optional(),
  projectTitle: z.string().trim().min(1).max(PROFILE_CONTRIBUTION_LIMITS.title),
  roleTitle: nullableText(PROFILE_CONTRIBUTION_LIMITS.role),
  summary: nullableText(PROFILE_CONTRIBUTION_LIMITS.summary),
  projectUrl: nullableUrlSchema,
  repositoryUrl: nullableUrlSchema,
  visibility: z.enum(["public", "private"]),
  skills: skillsSchema,
  dates: datedMutationSchema,
}).strict();

const deleteMutationSchema = z.object({
  kind: z.literal("external-delete"),
  contributionId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
}).strict();

export const profileContributionMutationSchema = z.discriminatedUnion("kind", [
  platformMutationSchema,
  externalMutationSchema,
  deleteMutationSchema,
]);

export const profileContributionBatchSchema = z.object({
  idempotencyKey: z.string().uuid(),
  mutations: z.array(profileContributionMutationSchema)
    .min(1)
    .max(PROFILE_CONTRIBUTION_LIMITS.batchSize),
}).strict().superRefine((value, context) => {
  const targets = new Set<string>();
  value.mutations.forEach((mutation, index) => {
    if (mutation.kind === "external" && mutation.contributionId && !mutation.expectedVersion) {
      context.addIssue({
        code: "custom",
        path: ["mutations", index, "expectedVersion"],
        message: "Existing contributions require an expected version",
      });
    }
    if (mutation.kind === "external" && !mutation.contributionId && mutation.expectedVersion) {
      context.addIssue({
        code: "custom",
        path: ["mutations", index, "expectedVersion"],
        message: "New contributions cannot include an expected version",
      });
    }
    const key = mutation.kind === "external" && !mutation.contributionId
      ? `external:${mutation.externalKey}`
      : `contribution:${mutation.contributionId}`;
    if (targets.has(key)) {
      context.addIssue({
        code: "custom",
        path: ["mutations", index],
        message: "A contribution can only be changed once per request",
      });
    }
    targets.add(key);
  });
});

export type ProfileContributionMutation = z.infer<typeof profileContributionMutationSchema>;
export type ProfileContributionBatch = z.infer<typeof profileContributionBatchSchema>;

export function contributionMonthToDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, 1));
}
