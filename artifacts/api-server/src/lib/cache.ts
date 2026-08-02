interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class TtlCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private staleStore = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  getStale<T>(key: string): T | undefined {
    return this.staleStore.get(key) as T | undefined;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    this.staleStore.set(key, value);
  }

  delete(key: string): void {
    this.store.delete(key);
    this.staleStore.delete(key);
  }

  size(): number {
    return this.store.size;
  }
}

export const psxCache = new TtlCache();

export async function withCache<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const cached = psxCache.get<T>(key);
  if (cached !== undefined) return cached;
  try {
    const value = await fn();
    psxCache.set(key, value, ttlMs);
    return value;
  } catch (err) {
    const stale = psxCache.getStale<T>(key);
    if (stale !== undefined) return stale;
    throw err;
  }
}

export const TTL = {
  STATUS: 15_000,
  STATS: 30_000,
  BREADTH: 30_000,
  SECTORS: 60_000,
  SYMBOLS: 10 * 60_000,
  FUNDAMENTALS: 5 * 60_000,
  COMPANY: 10 * 60_000,
  DIVIDENDS: 10 * 60_000,
  KLINES: 2 * 60_000,
  ANNOUNCEMENTS: 10 * 60_000,
} as const;
