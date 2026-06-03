// Deterministic, dependency-free computation of intraday session statistics
// from OHLCV candles. The LLM Q&A layer (intraday-qa.ts) uses these EXACT
// figures so the model never has to do error-prone arithmetic. OHLCV gives no
// tick data, so derived measures like VWAP and "volume around price X" are
// candle-resolution approximations (labeled as such for the model).

import type { Kline, Timeframe } from '../types';
import { describeMarketStatusFromSchedule } from '../market-status';

export const TF_MINUTES: Record<Timeframe, number> = {
  '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1440, '1w': 10080, '1M': 43200,
};

const karachiDateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit',
});
const karachiTimeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: false,
});

export function karachiDate(ts: number): string {
  return karachiDateFmt.format(new Date(ts));
}
export function karachiTime(ts: number): string {
  return karachiTimeFmt.format(new Date(ts));
}

/** Candles belonging to the most recent session day present in the data, sorted ascending by time. */
export function latestSessionKlines(klines: Kline[]): Kline[] {
  if (!klines.length) return [];
  const sorted = [...klines].sort((a, b) => a.timestamp - b.timestamp);
  const latestDate = karachiDate(sorted[sorted.length - 1].timestamp);
  return sorted.filter((k) => karachiDate(k.timestamp) === latestDate);
}

export interface VolumeBucket {
  from: number;
  to: number;
  volume: number;
  candles: number;
}

export interface IntradayStats {
  symbol: string;
  timeframe: Timeframe;
  minutesPerCandle: number;
  sessionDate: string; // Asia/Karachi YYYY-MM-DD
  asOf: string; // ISO timestamp of the last candle
  isToday: boolean;
  isStale: boolean;
  marketState: string;
  candleCount: number;
  open: number;
  close: number;
  last: number;
  high: { price: number; at: string };
  low: { price: number; at: string };
  totalVolume: number;
  vwapApprox: number;
  priceMin: number;
  priceMax: number;
  volumeProfile: VolumeBucket[];
}

const VOLUME_BUCKETS = 10;

/** Compute exact session stats. Assumes `klines` is non-empty (caller guards). */
export function computeIntradayStats(
  symbol: string,
  klines: Kline[],
  timeframe: Timeframe,
  now: Date = new Date(),
): IntradayStats {
  const session = latestSessionKlines(klines);
  const first = session[0];
  const lastCandle = session[session.length - 1];

  let high = first.high;
  let highAt = first.timestamp;
  let low = first.low;
  let lowAt = first.timestamp;
  let totalVolume = 0;
  let pvSum = 0; // Σ typicalPrice * volume
  let priceMin = first.low;
  let priceMax = first.high;

  for (const k of session) {
    if (k.high > high) { high = k.high; highAt = k.timestamp; }
    if (k.low < low) { low = k.low; lowAt = k.timestamp; }
    if (k.high > priceMax) priceMax = k.high;
    if (k.low < priceMin) priceMin = k.low;
    totalVolume += k.volume;
    const typical = (k.high + k.low + k.close) / 3;
    pvSum += typical * k.volume;
  }

  const vwapApprox = totalVolume > 0 ? pvSum / totalVolume : (high + low) / 2;

  // Volume profile: fixed-width price buckets across the session range; each
  // candle's volume is attributed to the bucket containing its close.
  const range = priceMax - priceMin;
  const bucketSize = range > 0 ? range / VOLUME_BUCKETS : 0;
  const buckets: VolumeBucket[] = Array.from({ length: bucketSize > 0 ? VOLUME_BUCKETS : 1 }, (_, i) => ({
    from: +(priceMin + i * bucketSize).toFixed(4),
    to: +(bucketSize > 0 ? priceMin + (i + 1) * bucketSize : priceMax).toFixed(4),
    volume: 0,
    candles: 0,
  }));
  for (const k of session) {
    const idx = bucketSize > 0
      ? Math.min(VOLUME_BUCKETS - 1, Math.max(0, Math.floor((k.close - priceMin) / bucketSize)))
      : 0;
    buckets[idx].volume += k.volume;
    buckets[idx].candles += 1;
  }

  const sessionDate = karachiDate(lastCandle.timestamp);
  const isToday = sessionDate === karachiDate(now.getTime());

  return {
    symbol,
    timeframe,
    minutesPerCandle: TF_MINUTES[timeframe],
    sessionDate,
    asOf: new Date(lastCandle.timestamp).toISOString(),
    isToday,
    isStale: !isToday,
    marketState: describeMarketStatusFromSchedule(now).label,
    candleCount: session.length,
    open: first.open,
    close: lastCandle.close,
    last: lastCandle.close,
    high: { price: high, at: karachiTime(highAt) },
    low: { price: low, at: karachiTime(lowAt) },
    totalVolume,
    vwapApprox: +vwapApprox.toFixed(4),
    priceMin,
    priceMax,
    volumeProfile: buckets,
  };
}

/** One compact line per candle: `HH:mm o/h/l/c v=<volume>` in Asia/Karachi time. */
export function serializeCandles(session: Kline[]): string {
  return session
    .map((k) => `${karachiTime(k.timestamp)} ${k.open}/${k.high}/${k.low}/${k.close} v=${k.volume}`)
    .join('\n');
}
