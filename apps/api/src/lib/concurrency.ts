/** Like Promise.all over `items.map(fn)`, with at most `limit` calls in flight. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Runs the functions given to it with at most `limit` in flight, the others waiting their turn. */
export function createLimiter(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <R>(fn: () => Promise<R>): Promise<R> => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
