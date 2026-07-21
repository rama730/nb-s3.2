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

export function formatCalendarDate(dateValue: string | Date): string {
  return new Date(dateValue).toLocaleDateString();
}

export function formatDateTime(dateValue: string | Date): string {
  return new Date(dateValue).toLocaleString();
}
