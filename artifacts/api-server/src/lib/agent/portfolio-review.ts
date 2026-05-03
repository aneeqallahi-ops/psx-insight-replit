import type { PortfolioHolding } from '@workspace/db/schema';
import { PSXApi } from '../psx-api';
import { analyze, extractJson } from './llm';
import type { Citation } from './types';

export interface PositionSnapshot {
  symbol: string;
  shares: number;
  avgBuyPrice: number;
  currentPrice: number | null;
  unrealizedPnlPct: number | null;
  weightPct: number;
  sector: string | null;
  peRatio: number | null;
  dividendYield: number | null;
}

export interface PortfolioReviewReport {
  healthScore: number; // 0-100
  headline: string;
  summary: string;
  perPosition: { symbol: string; commentary: string }[];
  risks: string[];
  rebalanceSuggestions: string[];
  citations: Citation[];
  generatedAt: string;
  positionsAnalyzed: number;
}

const SYSTEM = `You are a senior equity portfolio manager reviewing a retail investor's PSX portfolio.
Output strict JSON only with this exact shape:
{
  "healthScore": number 0-100,
  "headline": string (max 18 words),
  "summary": string (3-4 sentences overall view),
  "perPosition": [{"symbol": string, "commentary": string (1-2 sentences)}],
  "risks": string[] (3-5 short risk callouts),
  "rebalanceSuggestions": string[] (3-5 concrete actionable suggestions)
}

Guidelines:
- Address concentration risk (single stock or single sector >30% weight).
- Flag any non-performing or losing positions that may merit review.
- Comment on dividend income mix vs growth mix.
- Use PKR for currency.`;

export async function buildPositionSnapshots(
  holdings: PortfolioHolding[],
): Promise<PositionSnapshot[]> {
  const enriched = await Promise.all(
    holdings.map(async (h) => {
      const fundamentals = await PSXApi.getFundamentals(h.symbol).catch(() => null);
      const currentPrice = fundamentals?.price ?? null;
      const unrealizedPnlPct =
        currentPrice !== null && h.avgBuyPrice > 0
          ? ((currentPrice - h.avgBuyPrice) / h.avgBuyPrice) * 100
          : null;
      return {
        symbol: h.symbol,
        shares: h.shares,
        avgBuyPrice: h.avgBuyPrice,
        currentPrice,
        unrealizedPnlPct,
        weightValue: currentPrice !== null ? h.shares * currentPrice : 0,
        sector: fundamentals?.sector ?? null,
        peRatio: fundamentals?.peRatio ?? null,
        dividendYield: fundamentals?.dividendYield ?? null,
      };
    }),
  );

  const totalValue = enriched.reduce((s, p) => s + p.weightValue, 0);
  return enriched.map((p) => ({
    symbol: p.symbol,
    shares: p.shares,
    avgBuyPrice: p.avgBuyPrice,
    currentPrice: p.currentPrice,
    unrealizedPnlPct: p.unrealizedPnlPct,
    weightPct: totalValue > 0 ? (p.weightValue / totalValue) * 100 : 0,
    sector: p.sector,
    peRatio: p.peRatio,
    dividendYield: p.dividendYield,
  }));
}

export async function reviewPortfolio(
  holdings: PortfolioHolding[],
): Promise<PortfolioReviewReport> {
  if (holdings.length === 0) {
    return {
      healthScore: 0,
      headline: 'Portfolio is empty.',
      summary: 'Add at least one holding to receive a portfolio review.',
      perPosition: [],
      risks: [],
      rebalanceSuggestions: ['Add holdings on the Portfolio page to begin tracking and reviews.'],
      citations: [],
      generatedAt: new Date().toISOString(),
      positionsAnalyzed: 0,
    };
  }

  const snapshots = await buildPositionSnapshots(holdings);
  const sectorAgg: Record<string, number> = {};
  for (const s of snapshots) {
    const k = s.sector || 'Unknown';
    sectorAgg[k] = (sectorAgg[k] || 0) + s.weightPct;
  }
  const sectorBreakdown = Object.entries(sectorAgg)
    .map(([k, v]) => `${k}: ${v.toFixed(1)}%`)
    .join(', ');

  const positionLines = snapshots
    .map((s) => {
      const pnl = s.unrealizedPnlPct !== null ? `${s.unrealizedPnlPct >= 0 ? '+' : ''}${s.unrealizedPnlPct.toFixed(2)}%` : 'n/a';
      return `${s.symbol}: ${s.weightPct.toFixed(1)}% weight, ${s.shares} shares @ avg PKR ${s.avgBuyPrice.toFixed(2)} → curr PKR ${s.currentPrice?.toFixed(2) ?? 'n/a'} (P&L ${pnl}); sector ${s.sector ?? 'unknown'}; P/E ${s.peRatio?.toFixed(1) ?? 'n/a'}; div yld ${s.dividendYield?.toFixed(2) ?? 'n/a'}%`;
    })
    .join('\n');

  const prompt = `Portfolio overview (${snapshots.length} positions):
${positionLines}

Sector weights: ${sectorBreakdown}

Produce the JSON portfolio review now.`;

  const text = await analyze(prompt, { system: SYSTEM, maxTokens: 4096 });
  const parsed = extractJson<{
    healthScore: number;
    headline: string;
    summary: string;
    perPosition: { symbol: string; commentary: string }[];
    risks: string[];
    rebalanceSuggestions: string[];
  }>(text);

  return {
    healthScore: Math.max(0, Math.min(100, Number(parsed.healthScore) || 0)),
    headline: parsed.headline ?? 'Portfolio review',
    summary: parsed.summary ?? '',
    perPosition: Array.isArray(parsed.perPosition) ? parsed.perPosition : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks : [],
    rebalanceSuggestions: Array.isArray(parsed.rebalanceSuggestions) ? parsed.rebalanceSuggestions : [],
    citations: snapshots.map((s) => ({
      kind: 'fundamentals' as const,
      title: `${s.symbol} fundamentals snapshot`,
      source: 'psxterminal.com',
    })),
    generatedAt: new Date().toISOString(),
    positionsAnalyzed: snapshots.length,
  };
}
