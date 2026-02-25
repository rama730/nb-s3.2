/**
 * Client-only runner preferences (localStorage).
 * Guards typeof window for SSR.
 */
export function getRunnerPref(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setRunnerPref(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* noop */
  }
}
