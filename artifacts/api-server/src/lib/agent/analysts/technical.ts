import { PSXApi } from '../../psx-api';
import { computeIndicators } from '../indicators';
import { analyze, extractJson } from '../llm';
import type { Citation } from '../types';

export interface AnalystReport {
  summary: string;
  signals: string[];
  confidence: number; // 0-100
  citations: Citation[];
  raw?: unknown;
}

const SYSTEM = `You are a senior equity technical analyst covering the Pakistan Stock Exchange (PSX).
You review price action, moving averages, RSI, and MACD then produce a concise, evidence-based note.
Always answer in JSON with exact keys: {"summary": string, "signals": string[], "confidence": number 0-100}.
Keep summary under 4 sentences. Each signal entry is one short bullet (max 12 words).`;

export async function technicalAnalyst(symbol: string): Promise<AnalystReport> {
  const klines = await PSXApi.getKlines(symbol, '1d', { limit: 120 });
  if (klines.length < 30) {
    return {
      summary: 'Insufficient price history to compute reliable technicals.',
      signals: ['Less than 30 daily candles available'],
      confidence: 10,
      citations: [{
        kind: 'price',
        title: `PSX daily klines (${klines.length} candles available)`,
        source: 'psxterminal.com',
      }],
    };
  }

  const indicators = computeIndicators(klines);
  const lastDate = new Date(klines[klines.length - 1].timestamp).toISOString().slice(0, 10);
  const firstDate = new Date(klines[0].timestamp).toISOString().slice(0, 10);

  const prompt = `Symbol: ${symbol}
Period covered: ${firstDate} to ${lastDate} (${klines.length} daily candles)
Last close: PKR ${indicators.lastClose.toFixed(2)}
Trend (close vs SMA20 vs SMA50): ${indicators.trend}
SMA20: ${indicators.sma20?.toFixed(2) ?? 'n/a'}
SMA50: ${indicators.sma50?.toFixed(2) ?? 'n/a'}
RSI(14): ${indicators.rsi14?.toFixed(1) ?? 'n/a'}
MACD: ${indicators.macd ? `line ${indicators.macd.macd.toFixed(3)}, signal ${indicators.macd.signal.toFixed(3)}, hist ${indicators.macd.histogram.toFixed(3)}` : 'n/a'}
20-day realized volatility (daily, %): ${indicators.volatilityPct?.toFixed(2) ?? 'n/a'}

Write a technical analysis JSON note for ${symbol}. Reference the indicators by name. Avoid hedging language unless data is genuinely mixed.`;

  const text = await analyze(prompt, { system: SYSTEM });
  const parsed = extractJson<{ summary: string; signals: string[]; confidence: number }>(text);

  return {
    summary: parsed.summary,
    signals: Array.isArray(parsed.signals) ? parsed.signals.slice(0, 6) : [],
    confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
    citations: [{
      kind: 'price',
      title: `PSX daily klines (${klines.length} candles)`,
      source: 'psxterminal.com',
      asOf: `${firstDate} → ${lastDate}`,
    }],
    raw: indicators,
  };
}
