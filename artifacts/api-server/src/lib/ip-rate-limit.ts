// Lightweight in-memory, per-IP sliding-window rate limiter (no dependency).
// Mirrors the timestamp-array approach used by the global limiter in
// lib/agent/llm.ts, but keyed per client IP. This protects a public endpoint
// from a single abuser; the global limiter in llm.ts remains the hard ceiling
// on total spend across all LLM features.

export interface RateWindow {
  max: number;
  windowMs: number;
}

const hits = new Map<string, number[]>();
const MAX_KEYS = 10_000; // defensive cap so the map can't grow unbounded

export function checkIpLimit(
  ip: string,
  windows: RateWindow[],
): { ok: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const maxWindow = Math.max(...windows.map((w) => w.windowMs));
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < maxWindow);

  for (const w of windows) {
    const inWindow = recent.filter((t) => now - t < w.windowMs);
    if (inWindow.length >= w.max) {
      const retryAfterSec = Math.max(1, Math.ceil((w.windowMs - (now - inWindow[0])) / 1000));
      hits.set(ip, recent); // persist the prune, but do not record this (blocked) hit
      return { ok: false, retryAfterSec };
    }
  }

  recent.push(now);
  if (hits.size > MAX_KEYS) hits.clear();
  hits.set(ip, recent);
  return { ok: true };
}
