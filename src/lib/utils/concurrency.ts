export async function runWithConcurrency<T, R = void>(
  items: T[],
  concurrency: number,
  run: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;
  await Promise.all(
    Array.from({ length: workerCount }).map(async () => {
      while (cursor < items.length) {
        const index = cursor++;
        const item = items[index];
        if (item !== undefined) {
          results[index] = await run(item);
        }
      }
    })
  );
  return results;
}
