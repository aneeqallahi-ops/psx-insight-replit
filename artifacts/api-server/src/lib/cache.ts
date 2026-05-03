interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class TtlCache {
  private store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  size(): number {
    return this.store.size;
  }
}

export const psxCache = new TtlCache();

export async function withCache<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const cached = psxCache.get<T>(key);
  if (cached !== undefined) return cached;
  const value = await fn();
  psxCache.set(key, value, ttlMs);
  return value;
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
