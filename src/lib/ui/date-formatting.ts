import { isToday, isAfter, subDays } from "date-fns";

/**
 * Returns a human-readable "Active today" / "Active this week" label,
 * or null if the date is older than 7 days.
 */
export function formatLastActive(dateValue: string | Date | null | undefined): string | null {
  if (!dateValue) return null;
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return null;
  if (isToday(d)) return "Active today";
  if (isAfter(d, subDays(new Date(), 7))) return "Active this week";
  return null;
}

/**
 * Safely parse a date value, returning null for invalid dates.
 */
export function toValidDate(value: unknown): Date | null {
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? null : date;
}
