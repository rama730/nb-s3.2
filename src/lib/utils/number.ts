export function parsePositiveInteger(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
}

export function positiveIntegerOr(value: unknown, fallback: number) {
  return parsePositiveInteger(value) ?? fallback;
}
