export function toIsoString(value: Date | string | null | undefined): string | null {
  return toDateValue(value)?.toISOString() ?? null;
}

export function toRequiredIsoString(value: Date | string | null | undefined, fallback = new Date(0)): string {
  return toIsoString(value) ?? fallback.toISOString();
}

export function toDateValue(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
