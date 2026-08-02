// Shared HTTP helper for PSX portal calls (dps.psx.com.pk).
// Adds three things that individual scrapers used to do inconsistently:
//   - Global concurrency limit — cap simultaneous upstream fetches so a
//     traffic spike can't hammer PSX. Requests over the limit queue.
//   - Exponential backoff with jitter — retries wait 500ms · 2^attempt · (0.5-1.5)
//     instead of the deterministic linear schedule we had. Prevents thundering
//     herds where every retry syncs up.
//   - Retry-After respect — if PSX ever returns 429 or 503 with the header,
//     obey it before continuing to back off.

const MAX_CONCURRENT_PORTAL_FETCHES = 5;
let activeCount = 0;
const waitQueue: (() => void)[] = [];

function acquireSlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENT_PORTAL_FETCHES) {
    activeCount++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waitQueue.push(() => {
      activeCount++;
      resolve();
    });
  });
}

function releaseSlot(): void {
  activeCount--;
  const next = waitQueue.shift();
  if (next) next();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number): number {
  // 500ms · 2^attempt · [0.5, 1.5) jitter. Caps at ~4s so no request stalls
  // the whole slot for too long.
  const base = 500 * Math.pow(2, attempt);
  const jitter = 0.5 + Math.random();
  return Math.min(4000, Math.floor(base * jitter));
}

export interface PortalFetchOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
}

export async function portalFetch(url: string, options: PortalFetchOptions = {}): Promise<Response> {
  const { timeoutMs = 20_000, retries = 3, ...init } = options;
  await acquireSlot();
  try {
    let lastError: unknown;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const res = await fetch(url, {
          ...init,
          signal: AbortSignal.timeout(timeoutMs),
        });
        // Respect explicit backoff signals from the upstream.
        if ((res.status === 429 || res.status === 503) && attempt < retries - 1) {
          const retryAfterHeader = res.headers.get('Retry-After');
          const retryAfterSecs = retryAfterHeader ? Number(retryAfterHeader) : NaN;
          const waitMs = Number.isFinite(retryAfterSecs) && retryAfterSecs > 0
            ? Math.min(retryAfterSecs * 1000, 10_000)
            : backoffDelay(attempt);
          await sleep(waitMs);
          continue;
        }
        return res;
      } catch (err) {
        lastError = err;
        if (attempt < retries - 1) await sleep(backoffDelay(attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  } finally {
    releaseSlot();
  }
}
