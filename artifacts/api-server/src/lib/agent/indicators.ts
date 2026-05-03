import type { Kline } from '../types';

export interface IndicatorSnapshot {
  lastClose: number;
  sma20: number | null;
  sma50: number | null;
  rsi14: number | null;
  macd: { macd: number; signal: number; histogram: number } | null;
  trend: 'up' | 'down' | 'sideways';
  volatilityPct: number | null;
}

export function sma(values: number[], period: number): (number | null)[] {
  if (period <= 0) return values.map(() => null);
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  if (period <= 0) return values.map(() => null);
  const out: (number | null)[] = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out.push(null);
    } else if (i === period - 1) {
      const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
      out.push(seed);
      prev = seed;
    } else {
      const next: number = values[i] * k + (prev as number) * (1 - k);
      out.push(next);
      prev = next;
    }
  }
  return out;
}

export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = [];
  if (values.length <= period) return values.map(() => null);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = 0; i < values.length; i++) {
    if (i < period) {
      out.push(null);
      continue;
    }
    if (i > period) {
      const diff = values[i] - values[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    if (avgLoss === 0) {
      out.push(100);
    } else {
      const rs = avgGain / avgLoss;
      out.push(100 - 100 / (1 + rs));
    }
  }
  return out;
}

export function macd(values: number[]): { macd: (number | null)[]; signal: (number | null)[]; histogram: (number | null)[] } {
  const ema12 = ema(values, 12);
  const ema26 = ema(values, 26);
  const macdLine = values.map((_, i) => {
    const a = ema12[i];
    const b = ema26[i];
    return a !== null && b !== null ? a - b : null;
  });
  const macdNumeric = macdLine.map((v) => (v ?? 0));
  const signal = ema(macdNumeric, 9).map((v, i) => (macdLine[i] === null ? null : v));
  const histogram = macdLine.map((m, i) => {
    const s = signal[i];
    return m !== null && s !== null ? m - s : null;
  });
  return { macd: macdLine, signal, histogram };
}

export function computeIndicators(klines: Kline[]): IndicatorSnapshot {
  const closes = klines.map((k) => k.close);
  const last = closes[closes.length - 1] ?? 0;
  const sma20Arr = sma(closes, 20);
  const sma50Arr = sma(closes, 50);
  const rsiArr = rsi(closes, 14);
  const macdData = macd(closes);

  const sma20Val = sma20Arr[sma20Arr.length - 1];
  const sma50Val = sma50Arr[sma50Arr.length - 1];
  const rsi14Val = rsiArr[rsiArr.length - 1];
  const macdVal = macdData.macd[macdData.macd.length - 1];
  const signalVal = macdData.signal[macdData.signal.length - 1];
  const histVal = macdData.histogram[macdData.histogram.length - 1];

  let trend: 'up' | 'down' | 'sideways' = 'sideways';
  if (sma20Val !== null && sma50Val !== null) {
    if (last > sma20Val && sma20Val > sma50Val) trend = 'up';
    else if (last < sma20Val && sma20Val < sma50Val) trend = 'down';
  }

  let vol: number | null = null;
  const window = closes.slice(-20);
  if (window.length >= 5) {
    const returns: number[] = [];
    for (let i = 1; i < window.length; i++) {
      const prev = window[i - 1];
      if (prev > 0) returns.push((window[i] - prev) / prev);
    }
    if (returns.length > 0) {
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
      vol = Math.sqrt(variance) * 100;
    }
  }

  return {
    lastClose: last,
    sma20: sma20Val,
    sma50: sma50Val,
    rsi14: rsi14Val,
    macd: macdVal !== null && signalVal !== null && histVal !== null
      ? { macd: macdVal, signal: signalVal, histogram: histVal }
      : null,
    trend,
    volatilityPct: vol,
  };
}
