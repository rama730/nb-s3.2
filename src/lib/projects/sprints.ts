import { z } from "zod";

const DATE_INPUT_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_SPRINT_DURATION_DAYS = 14;

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

export type CreateSprintDraftInput = z.infer<typeof createSprintDraftSchema>;
export type CreateSprintInput = z.infer<typeof createSprintSchema>;
