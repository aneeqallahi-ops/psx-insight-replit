// Optional Redis-backed L2 cache. Survives Railway deploys (in-memory L1 does
// not), so users don't hit fresh upstream calls on every redeploy.
//
// Design:
//   - Fresh key `psx:fresh:{key}` — TTL matches the in-memory TTL.
//   - Stale key `psx:stale:{key}` — long TTL (30d) so we can serve last-known-
//     good data during upstream outages after the fresh key expires.
//   - If REDIS_URL is unset OR the client fails to connect, all methods become
//     no-ops and the app falls back to in-memory only. No hard dependency.

import Redis, { type Redis as RedisClient } from 'ioredis';
import { logger } from './logger';

const STALE_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

let client: RedisClient | null = null;
let connecting = false;
let disabledUntil = 0; // circuit-break after repeated failures

function markUnhealthy(): void {
  disabledUntil = Date.now() + 60_000; // back off for 60s on repeated errors
}

function isDisabled(): boolean {
  return Date.now() < disabledUntil;
}

function getClient(): RedisClient | null {
  if (client || connecting) return client;
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  connecting = true;
  try {
    const c = new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      connectTimeout: 5_000,
    });
    c.on('error', (err) => {
      // Log at debug — errors happen during transient reconnects and are
      // handled gracefully. We don't want a firehose of warnings.
      logger.debug({ err: err.message }, 'redis-cache: client error');
      markUnhealthy();
    });
    c.on('connect', () => {
      logger.info({ url: url.replace(/:[^:]*@/, ':***@') }, 'redis-cache: connected');
    });
    client = c;
  } catch (err) {
    logger.warn({ err }, 'redis-cache: failed to construct client, falling back to memory-only');
  } finally {
    connecting = false;
  }
  return client;
}

/**
 * Try to read a fresh value from Redis. Returns undefined on miss, on
 * serialization failure, or when Redis is unavailable.
 */
export async function redisGetFresh<T>(key: string): Promise<T | undefined> {
  if (isDisabled()) return undefined;
  const c = getClient();
  if (!c) return undefined;
  try {
    const raw = await c.get(`psx:fresh:${key}`);
    if (!raw) return undefined;
    return JSON.parse(raw) as T;
  } catch (err) {
    logger.debug({ err: (err as Error).message, key }, 'redis-cache: getFresh failed');
    markUnhealthy();
    return undefined;
  }
}

/**
 * Read the last-known-good value even after the fresh copy has expired.
 * Used as a fallback when both the in-memory stale copy and the upstream
 * fetch are unavailable.
 */
export async function redisGetStale<T>(key: string): Promise<T | undefined> {
  if (isDisabled()) return undefined;
  const c = getClient();
  if (!c) return undefined;
  try {
    const raw = await c.get(`psx:stale:${key}`);
    if (!raw) return undefined;
    return JSON.parse(raw) as T;
  } catch (err) {
    logger.debug({ err: (err as Error).message, key }, 'redis-cache: getStale failed');
    markUnhealthy();
    return undefined;
  }
}

/**
 * Persist a value to both the fresh and stale slots. Fire-and-forget — never
 * blocks the caller on Redis latency, and swallows all errors.
 */
export function redisSet<T>(key: string, value: T, ttlMs: number): void {
  if (isDisabled()) return;
  const c = getClient();
  if (!c) return;
  let payload: string;
  try {
    payload = JSON.stringify(value);
  } catch (err) {
    logger.debug({ err: (err as Error).message, key }, 'redis-cache: JSON.stringify failed');
    return;
  }
  // Cap serialized size — anything above 5 MB is almost certainly a bug and
  // would just fill Redis memory.
  if (payload.length > 5 * 1024 * 1024) {
    logger.debug({ key, bytes: payload.length }, 'redis-cache: skipping oversized value');
    return;
  }
  const ttlSecs = Math.max(1, Math.ceil(ttlMs / 1000));
  Promise.all([
    c.set(`psx:fresh:${key}`, payload, 'EX', ttlSecs),
    c.set(`psx:stale:${key}`, payload, 'EX', STALE_TTL_SECONDS),
  ]).catch((err) => {
    logger.debug({ err: (err as Error).message, key }, 'redis-cache: set failed');
    markUnhealthy();
  });
}
