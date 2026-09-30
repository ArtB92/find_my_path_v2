/** Small in-memory LRU for pure, expensive lookups. Caches the promise so concurrent callers share one request. */
export function createCache<V>(maxEntries: number) {
  const entries = new Map<string, Promise<V>>();

  return function cached(key: string, load: () => Promise<V>): Promise<V> {
    const hit = entries.get(key);
    if (hit) {
      entries.delete(key);
      entries.set(key, hit);
      return hit;
    }
    const pending = load();
    entries.set(key, pending);
    pending.catch(() => entries.delete(key));
    if (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) entries.delete(oldest);
    }
    return pending;
  };
}
