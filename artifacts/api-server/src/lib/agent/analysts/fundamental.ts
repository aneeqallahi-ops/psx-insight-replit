import { PSXApi } from '../../psx-api';
import { analyze, extractJson } from '../llm';
import type { Citation } from '../types';
import type { AnalystReport } from './technical';

const SYSTEM = `You are a senior equity fundamental analyst covering the Pakistan Stock Exchange (PSX).
You review valuation multiples, dividend history, sector positioning, and company profile.
Always answer in JSON with exact keys: {"summary": string, "signals": string[], "confidence": number 0-100}.
Keep summary under 4 sentences. Each signal is one short bullet (max 14 words).
PKR is the local currency. Use "non-compliant" Shariah status as a risk flag if applicable.`;

export async function fundamentalAnalyst(symbol: string): Promise<AnalystReport> {
  const [fundamentalsR, dividendsR, companyR] = await Promise.allSettled([
    PSXApi.getFundamentals(symbol),
    PSXApi.getDividends(symbol),
    PSXApi.getCompany(symbol),
  ]);

  const fundamentals = fundamentalsR.status === 'fulfilled' ? fundamentalsR.value : null;
  const dividends = dividendsR.status === 'fulfilled' ? dividendsR.value : [];
  const company = companyR.status === 'fulfilled' ? companyR.value : null;

  if (!fundamentals) {
    return {
      summary: 'Fundamentals feed unavailable for this symbol.',
      signals: ['No fundamentals data returned by PSX API'],
      confidence: 10,
      citations: [],
    };
  }

  const recentDivs = dividends.slice(0, 5).map((d) => `${d.year}: PKR ${d.amount.toFixed(2)} (ex ${d.ex_date})`).join('; ') || 'none';
  const snapshotDate = fundamentals.timestamp ? new Date(fundamentals.timestamp).toISOString().slice(0, 10) : 'recent';

  const prompt = `Symbol: ${symbol}
Sector: ${fundamentals.sector || 'unknown'}
Listed in: ${fundamentals.listedIn || 'unknown'}
Current price: PKR ${fundamentals.price.toFixed(2)} (snapshot ${snapshotDate})
Market cap: ${fundamentals.marketCap || 'n/a'}
P/E ratio: ${fundamentals.peRatio?.toFixed(2) ?? 'n/a'}
Dividend yield: ${fundamentals.dividendYield?.toFixed(2) ?? 'n/a'}%
1-year change: ${fundamentals.yearChange?.toFixed(2) ?? 'n/a'}%
30-day avg volume: ${fundamentals.volume30Avg?.toLocaleString() ?? 'n/a'}
Free float: ${fundamentals.freeFloat || 'n/a'}
Non-compliant (Shariah): ${fundamentals.isNonCompliant ? 'yes' : 'no'}
Recent dividends: ${recentDivs}
${company ? `Business description (truncated): ${(company.businessDescription || '').slice(0, 600)}` : ''}

Write a fundamental analysis JSON note for ${symbol}. Anchor commentary in the numbers. Call out valuation, payout, and balance-sheet/sector signals.`;

  const text = await analyze(prompt, { system: SYSTEM });
  const parsed = extractJson<{ summary: string; signals: string[]; confidence: number }>(text);

  return {
    summary: parsed.summary,
    signals: Array.isArray(parsed.signals) ? parsed.signals.slice(0, 6) : [],
    confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
    citations: ([
      { kind: 'fundamentals', title: `${symbol} fundamentals snapshot`, source: 'psxterminal.com', asOf: snapshotDate },
      dividends.length ? { kind: 'fundamentals', title: `${symbol} dividend history (${dividends.length} entries)`, source: 'psxterminal.com' } : null,
      company ? { kind: 'fundamentals', title: `${symbol} company profile`, source: 'psxterminal.com' } : null,
    ].filter(Boolean) as Citation[]),
    raw: { fundamentals, dividendsCount: dividends.length },
  };
}
