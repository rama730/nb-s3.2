import { z } from "zod";

import type { SprintListItem } from "@/lib/projects/sprint-detail";

const DATE_INPUT_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_SPRINT_DURATION_DAYS = 14;

export type SprintEditorMode = "create" | "edit";

export type SprintEditorDraft = {
  name: string;
  goal: string;
  description: string;
  startDate: string;
  endDate: string;
};

export type SprintDeleteImpact = {
  sprintId: string;
  sprintName: string;
  sprintStatus: SprintListItem["status"];
  affectedTaskCount: number;
  canDelete: boolean;
  reason: string | null;
};

export type DeleteSprintResult = {
  success: boolean;
  error?: string;
  deletedSprintId?: string;
  affectedTaskCount?: number;
  previousStatus?: SprintListItem["status"];
};

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function formatUtcDateInput(date: Date) {
  return `${date.getUTCFullYear()}-${padDatePart(date.getUTCMonth() + 1)}-${padDatePart(date.getUTCDate())}`;
}

export function formatSprintDateInput(date: Date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

export function parseSprintDateInput(value: string) {
  const normalized = value.trim();
  if (!DATE_INPUT_REGEX.test(normalized)) {
    throw new Error("Sprint date must use the YYYY-MM-DD format");
  }

  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || formatUtcDateInput(parsed) !== normalized) {
    throw new Error("Sprint date is invalid");
  }

  return parsed;
}

export function addDaysToSprintDateInput(value: string, days: number) {
  const baseDate = parseSprintDateInput(value);
  return formatUtcDateInput(new Date(baseDate.getTime() + Math.trunc(days) * DAY_IN_MS));
}

export function getDefaultSprintDateRange(referenceDate: Date = new Date()) {
  const startDate = formatSprintDateInput(referenceDate);
  return {
    startDate,
    endDate: addDaysToSprintDateInput(startDate, DEFAULT_SPRINT_DURATION_DAYS),
  };
}

const optionalTrimmedText = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

const sprintDateSchema = z
  .string()
  .trim()
  .min(1, "Sprint dates are required")
  .refine((value) => {
    try {
      parseSprintDateInput(value);
      return true;
    } catch {
      return false;
    }
  }, "Sprint date is invalid");

export const createSprintDraftSchema = z
  .object({
    name: z.string().trim().min(1, "Sprint name is required").max(120, "Sprint name is too long"),
    goal: optionalTrimmedText,
    description: optionalTrimmedText,
    startDate: sprintDateSchema,
    endDate: sprintDateSchema,
  })
  .superRefine((value, ctx) => {
    let startDate: Date;
    let endDate: Date;

    try {
      startDate = parseSprintDateInput(value.startDate);
      endDate = parseSprintDateInput(value.endDate);
    } catch {
      return;
    }

    if (endDate.getTime() <= startDate.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "End date must be after start date",
      });
    }
  });

export const createSprintSchema = createSprintDraftSchema.extend({
  projectId: z.string().uuid(),
});

export const updateSprintSchema = createSprintDraftSchema.extend({
  projectId: z.string().uuid(),
  sprintId: z.string().uuid(),
});

export const deleteSprintSchema = z.object({
  projectId: z.string().uuid(),
  sprintId: z.string().uuid(),
});

function splitIsoDateInput(value: string | null | undefined) {
  if (!value || typeof value !== "string") return "";
  return value.split("T")[0] ?? "";
}

export function buildSprintEditorDraft(input: {
  sprint?: Pick<SprintListItem, "name" | "goal" | "description" | "startDate" | "endDate"> | null;
  sprintCount?: number;
  referenceDate?: Date;
}): SprintEditorDraft {
  const defaultDateRange = getDefaultSprintDateRange(input.referenceDate);
  if (!input.sprint) {
    return {
      name: `Sprint ${(input.sprintCount ?? 0) + 1}`,
      goal: "",
      description: "",
      startDate: defaultDateRange.startDate,
      endDate: defaultDateRange.endDate,
    };
  }

  return {
    name: input.sprint.name,
    goal: input.sprint.goal ?? "",
    description: input.sprint.description ?? "",
    startDate: splitIsoDateInput(input.sprint.startDate) || defaultDateRange.startDate,
    endDate: splitIsoDateInput(input.sprint.endDate) || defaultDateRange.endDate,
  };
}

export function buildSprintDeleteImpact(input: {
  sprint: Pick<SprintListItem, "id" | "name" | "status">;
  affectedTaskCount: number;
}): SprintDeleteImpact {
  const canDelete = input.sprint.status !== "active";
  return {
    sprintId: input.sprint.id,
    sprintName: input.sprint.name,
    sprintStatus: input.sprint.status,
    affectedTaskCount: Math.max(0, input.affectedTaskCount),
    canDelete,
    reason: canDelete ? null : "Active sprints must be completed before they can be deleted.",
  };
}

export function getSprintDurationSummary(startDate: string, endDate: string) {
  try {
    const start = parseSprintDateInput(startDate);
    const end = parseSprintDateInput(endDate);
    const durationDays = Math.round((end.getTime() - start.getTime()) / DAY_IN_MS);
    if (durationDays <= 0) return null;
    const durationWeeks = Number((durationDays / 7).toFixed(durationDays % 7 === 0 ? 0 : 1));
    return {
      durationDays,
      durationWeeks,
      label: `${durationDays} day${durationDays === 1 ? "" : "s"} · ${durationWeeks} week${durationWeeks === 1 ? "" : "s"}`,
    };
  } catch {
    return null;
  }
}

export type CreateSprintDraftInput = z.infer<typeof createSprintDraftSchema>;
export type CreateSprintInput = z.infer<typeof createSprintSchema>;
export type UpdateSprintInput = z.infer<typeof updateSprintSchema>;
export type DeleteSprintInput = z.infer<typeof deleteSprintSchema>;
