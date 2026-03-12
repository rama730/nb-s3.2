const MONOTONIC_CACHE_LIMIT = 5_000;
const monotonicVersionByKey = new Map<string, number>();

function evictOldestIfNeeded() {
  if (monotonicVersionByKey.size <= MONOTONIC_CACHE_LIMIT) return;
  const overflow = monotonicVersionByKey.size - MONOTONIC_CACHE_LIMIT;
  const keys = monotonicVersionByKey.keys();
  for (let i = 0; i < overflow; i += 1) {
    const key = keys.next().value;
    if (!key) break;
    monotonicVersionByKey.delete(key);
  }
}

export function runMonotonicUpdate<T>(
  entityKey: string,
  version: number,
  applyFn: () => T,
): T | null {
  const current = monotonicVersionByKey.get(entityKey);
  if (typeof current === "number" && version < current) {
    return null;
  }
  monotonicVersionByKey.set(entityKey, version);
  evictOldestIfNeeded();
  return applyFn();
}

export function resetMonotonicEntity(entityKey: string) {
  monotonicVersionByKey.delete(entityKey);
}

