// Historical chart data from PSX's official Data Portal.
//
//   /timeseries/int/{SYMBOL}  → intraday ticks: [[unix_secs, price, volume], ...]
//   /timeseries/eod/{SYMBOL}  → end-of-day:     [[unix_secs, close, volume, ldcp], ...]
//
// Replaces psxterminal.com klines as the primary chart source.

import type { Kline, Timeframe } from './types';
import { withCache, TTL } from './cache';
import { portalFetch } from './psx-http';

const DPS_BASE_URL = process.env.PSX_DPS_BASE_URL || 'https://dps.psx.com.pk';

const REQUEST_HEADERS = {
  Accept: 'application/json, */*;q=0.1',
  'User-Agent': 'Mozilla/5.0 (compatible; PSX-Insight/1.0)',
  'X-Requested-With': 'XMLHttpRequest',
};

interface TimeseriesResponse {
  status: number;
  message?: string;
  data?: (number | string)[][];
}

async function fetchTimeseriesJson(path: string): Promise<(number | string)[][]> {
  const res = await portalFetch(`${DPS_BASE_URL}${path}`, {
    headers: REQUEST_HEADERS,
    timeoutMs: 20_000,
  });
  if (!res.ok) throw new Error(`PSX timeseries ${path} error: ${res.status}`);
  const json = (await res.json()) as TimeseriesResponse;
  if (json.status !== 1 || !Array.isArray(json.data)) {
    throw new Error(`PSX timeseries ${path} invalid response`);
  }
  return json.data;
}

function toNumber(v: number | string | undefined): number {
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Intraday ticks aggregated into klines at the requested granularity.
 * Each row from the portal is [timestamp_secs, price, volume]. We bucket
 * ticks into candles (open = first price, close = last price, high = max,
 * low = min, volume = sum) — cheap to do in code and gives us real OHLC.
 */
function bucketIntradayIntoKlines(
  symbol: string,
  timeframe: Timeframe,
  raw: (number | string)[][],
  limit: number,
): Kline[] {
  const bucketSecs =
    timeframe === '1m' ? 60 :
    timeframe === '5m' ? 300 :
    timeframe === '15m' ? 900 :
    timeframe === '1h' ? 3600 :
    timeframe === '4h' ? 14400 :
    60;

  const buckets = new Map<number, { open: number; high: number; low: number; close: number; volume: number }>();
  const sortedRaw = [...raw].sort((a, b) => toNumber(a[0]) - toNumber(b[0]));

  for (const row of sortedRaw) {
    const ts = toNumber(row[0]);
    const price = toNumber(row[1]);
    const volume = toNumber(row[2]);
    if (!ts || !price) continue;
    const bucketStart = Math.floor(ts / bucketSecs) * bucketSecs;
    const existing = buckets.get(bucketStart);
    if (!existing) {
      buckets.set(bucketStart, { open: price, high: price, low: price, close: price, volume });
    } else {
      existing.high = Math.max(existing.high, price);
      existing.low = Math.min(existing.low, price);
      existing.close = price;
      existing.volume += volume;
    }
  }

  const klines: Kline[] = Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([bucketStart, c]) => ({
      symbol,
      timeframe,
      timestamp: bucketStart * 1000,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));

  return klines.slice(-limit);
}

/**
 * EOD candles. Portal shape is [timestamp_secs, close, volume, ldcp].
 * We don't get OHL from the portal, so we synthesize: open = ldcp (previous
 * day's close), high/low = close. The chart still renders correctly as a
 * line/close chart; the daily open→close move is real.
 */
function eodToKlines(
  symbol: string,
  timeframe: Timeframe,
  raw: (number | string)[][],
  limit: number,
): Kline[] {
  const klines: Kline[] = raw
    .map((row) => {
      const ts = toNumber(row[0]);
      const close = toNumber(row[1]);
      const volume = toNumber(row[2]);
      const ldcp = row.length > 3 ? toNumber(row[3]) : close;
      const open = ldcp || close;
      return {
        symbol,
        timeframe,
        timestamp: ts * 1000,
        open,
        high: Math.max(open, close),
        low: Math.min(open, close),
        close,
        volume,
      };
    })
    .filter((k) => k.timestamp && k.close)
    .sort((a, b) => a.timestamp - b.timestamp);
  return klines.slice(-limit);
}

/** Klines for the given symbol/timeframe, via PSX portal timeseries endpoints. */
export async function getPortalKlines(symbol: string, timeframe: Timeframe, limit: number): Promise<Kline[]> {
  const upper = symbol.toUpperCase();
  const isIntraday = timeframe === '1m' || timeframe === '5m' || timeframe === '15m' || timeframe === '1h' || timeframe === '4h';
  if (isIntraday) {
    const raw = await withCache(
      `psx-portal:ts:int:${upper}`,
      60_000,
      () => fetchTimeseriesJson(`/timeseries/int/${encodeURIComponent(upper)}`),
    );
    return bucketIntradayIntoKlines(upper, timeframe, raw, limit);
  }
  const raw = await withCache(
    `psx-portal:ts:eod:${upper}`,
    TTL.KLINES,
    () => fetchTimeseriesJson(`/timeseries/eod/${encodeURIComponent(upper)}`),
  );
  return eodToKlines(upper, timeframe, raw, limit);
}
