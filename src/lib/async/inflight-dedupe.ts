const inFlightPromises = new Map<string, Promise<unknown>>();

/**
 * Shares the same in-flight promise for identical keys.
 * This is request dedupe, not result caching.
 */
export function runInFlightDeduped<T>(key: string, task: () => Promise<T>): Promise<T> {
  const existing = inFlightPromises.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const next = Promise.resolve()
    .then(task)
    .finally(() => {
      if (inFlightPromises.get(key) === next) {
        inFlightPromises.delete(key);
      }
    });

  inFlightPromises.set(key, next);
  return next;
}

