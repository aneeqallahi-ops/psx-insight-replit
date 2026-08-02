interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class TtlCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private staleStore = new Map<string, unknown>();
  private pending = new Map<string, Promise<unknown>>();

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

  getPending<T>(key: string): Promise<T> | undefined {
    return this.pending.get(key) as Promise<T> | undefined;
  }

  setPending<T>(key: string, promise: Promise<T>): void {
    this.pending.set(key, promise);
    // Always clear the pending entry after the promise settles so a later
    // caller can trigger a fresh fetch (subject to TTL). Handle both settle
    // paths explicitly — a bare `.finally()` returns a new promise that
    // re-throws on rejection, which becomes an unhandled rejection and
    // crashes Node.js 24.
    const clear = () => {
      if (this.pending.get(key) === promise) this.pending.delete(key);
    };
    promise.then(clear, clear);
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

// Redis L2. When REDIS_URL is unset, all three helpers no-op and this reduces
// to the in-memory-only behavior we had before.
import { redisGetFresh, redisGetStale, redisSet } from './redis-cache';

export async function withCache<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  // L1 (in-memory) hit — fastest path.
  const cached = psxCache.get<T>(key);
  if (cached !== undefined) return cached;

  // In-flight dedup: if another caller is already fetching this key, wait
  // for their result instead of triggering a duplicate upstream request.
  const inflight = psxCache.getPending<T>(key);
  if (inflight) return inflight;

  const promise = (async () => {
    // L2 (Redis) hit — survives process restarts/deploys.
    const l2Fresh = await redisGetFresh<T>(key);
    if (l2Fresh !== undefined) {
      // Warm the L1 for future in-process reads.
      psxCache.set(key, l2Fresh, ttlMs);
      return l2Fresh;
    }
    try {
      const value = await fn();
      psxCache.set(key, value, ttlMs);
      redisSet(key, value, ttlMs); // fire-and-forget
      return value;
    } catch (err) {
      // Fallback to L1 stale, then L2 stale.
      const memStale = psxCache.getStale<T>(key);
      if (memStale !== undefined) return memStale;
      const redisStale = await redisGetStale<T>(key);
      if (redisStale !== undefined) {
        psxCache.set(key, redisStale, ttlMs);
        return redisStale;
      }
      throw err;
    }
  })();

  psxCache.setPending(key, promise);
  return promise;
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
