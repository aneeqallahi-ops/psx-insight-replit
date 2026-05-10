import { Router } from 'express';
import { PSXApi } from '../lib/psx-api';
import type { Dividend, Fundamentals, Tick } from '../lib/types';
import { db } from '@workspace/db';
import { portfolioHoldings, taxProfiles, portfolioLots, type PortfolioLot } from '@workspace/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getAcquisitionRegime, daysBetween, lookupCgtRate } from '../lib/cgt';

const holdingSchema = z.object({
  symbol: z.string().min(1).max(20).regex(/^[A-Za-z0-9-]+$/, 'Invalid symbol'),
  shares: z.number().finite().positive(),
  avgBuyPrice: z.number().finite().positive(),
  buyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'buyDate must be YYYY-MM-DD'),
  drip: z.boolean(),
  addedAt: z.string().datetime({ offset: true }),
});

const putPositionsSchema = z.object({
  positions: z.array(holdingSchema).max(100),
});

const putTaxProfileSchema = z.object({
  filerStatus: z.enum(['filer', 'non-filer']),
  setAt: z.string().datetime({ offset: true }),
});

const router = Router();

interface PortfolioHoldingData {
  symbol: string;
  tick: Tick | null;
  fundamentals: Fundamentals | null;
  dividends: Dividend[];
  error?: string;
}

async function fetchHolding(symbol: string): Promise<PortfolioHoldingData> {
  try {
    const [tick, fundamentals, dividends] = await Promise.all([
      PSXApi.getTick('REG', symbol),
      PSXApi.getFundamentals(symbol),
      PSXApi.getDividends(symbol),
    ]);
    return { symbol, tick, fundamentals, dividends };
  } catch (error) {
    return { symbol, tick: null, fundamentals: null, dividends: [], error: error instanceof Error ? error.message : `Unable to load ${symbol}` };
  }
}

async function runLimited<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    results.push(...(await Promise.all(chunk.map(worker))));
  }
  return results;
}

router.get('/portfolio/holdings', async (req, res) => {
  const symbols = Array.from(
    new Set(
      ((req.query.symbols as string) ?? '')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  ).slice(0, 50);

  if (symbols.length === 0) {
    res.json({ items: [], updatedAt: Date.now() });
    return;
  }

  const items = await runLimited(symbols, 5, fetchHolding);
  res.json({ items, updatedAt: Date.now() });
});

router.get('/portfolio/positions', async (req, res) => {
  const sessionId = req.portfolioSessionId;
  const rows = await db
    .select()
    .from(portfolioHoldings)
    .where(eq(portfolioHoldings.sessionId, sessionId));
  const positions = rows.map((row) => ({
    symbol: row.symbol,
    shares: row.shares,
    avgBuyPrice: row.avgBuyPrice,
    buyDate: row.buyDate,
    drip: row.drip,
    addedAt: row.addedAt,
  }));
  res.json({ positions });
});

router.put('/portfolio/positions', async (req, res) => {
  const sessionId = req.portfolioSessionId;
  const parsed = putPositionsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid positions payload', details: parsed.error.flatten() });
    return;
  }
  const { positions } = parsed.data;
  await db.transaction(async (tx) => {
    await tx.delete(portfolioHoldings).where(eq(portfolioHoldings.sessionId, sessionId));
    if (positions.length > 0) {
      await tx.insert(portfolioHoldings).values(
        positions.map((p) => ({
          sessionId,
          symbol: p.symbol.toUpperCase(),
          shares: p.shares,
          avgBuyPrice: p.avgBuyPrice,
          buyDate: p.buyDate,
          drip: p.drip,
          addedAt: p.addedAt,
        })),
      );
    }
  });
  res.json({ ok: true });
});

router.get('/portfolio/tax-profile', async (req, res) => {
  const sessionId = req.portfolioSessionId;
  const rows = await db
    .select()
    .from(taxProfiles)
    .where(eq(taxProfiles.sessionId, sessionId));
  if (rows.length === 0) {
    res.json({ taxProfile: null });
    return;
  }
  const row = rows[0];
  res.json({ taxProfile: { filerStatus: row.filerStatus, setAt: row.setAt } });
});

router.put('/portfolio/tax-profile', async (req, res) => {
  const sessionId = req.portfolioSessionId;
  const parsed = putTaxProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid tax profile payload', details: parsed.error.flatten() });
    return;
  }
  const { filerStatus, setAt } = parsed.data;
  await db
    .insert(taxProfiles)
    .values({ sessionId, filerStatus, setAt })
    .onConflictDoUpdate({
      target: taxProfiles.sessionId,
      set: { filerStatus, setAt, updatedAt: new Date() },
    });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Lot-level portfolio — portfolio v2
// ---------------------------------------------------------------------------

const NCCPL_EXPENSE_RATE = 0.005; // 0.5% standard expense, both sides

async function loadOrBackfillLots(sessionId: string): Promise<{ lots: PortfolioLot[]; backfilled: boolean }> {
  let lots = await db
    .select()
    .from(portfolioLots)
    .where(eq(portfolioLots.sessionId, sessionId))
    .orderBy(portfolioLots.acquisitionDate);

  if (lots.length > 0) return { lots, backfilled: false };

  // Auto-backfill from legacy portfolio_holdings (one lot per existing row).
  const legacy = await db
    .select()
    .from(portfolioHoldings)
    .where(eq(portfolioHoldings.sessionId, sessionId));

  if (legacy.length === 0) return { lots: [], backfilled: false };

  const newLots = legacy.map((h) => ({
    sessionId,
    symbol: h.symbol.toUpperCase(),
    acquisitionDate: h.buyDate,
    quantityPurchased: h.shares,
    quantityRemaining: h.shares,
    costPerShare: h.avgBuyPrice,
    commissionPaid: 0,
    acquisitionRegime: getAcquisitionRegime(h.buyDate),
    source: 'manual' as const,
    drip: h.drip,
    notes: 'Migrated from legacy portfolio (averaged cost, single lot approximation).',
  }));

  const inserted = await db.insert(portfolioLots).values(newLots).returning();
  lots = inserted.sort((a, b) => a.acquisitionDate.localeCompare(b.acquisitionDate));
  return { lots, backfilled: true };
}

const BACKFILL_NOTICE =
  'Your existing positions were imported as single lots using the averaged cost and earliest buy date. ' +
  'For accurate CGT calculations, consider splitting lots that cover multiple purchases at different prices.';

router.get('/portfolio/lots', async (req, res) => {
  const sessionId = req.portfolioSessionId;
  const { lots, backfilled } = await loadOrBackfillLots(sessionId);
  res.json({ lots, backfilled, ...(backfilled ? { notice: BACKFILL_NOTICE } : {}) });
});

router.get('/portfolio/lots/snapshot', async (req, res) => {
  const sessionId = req.portfolioSessionId;
  const { lots, backfilled } = await loadOrBackfillLots(sessionId);

  // Resolve filer status (default to 'filer' if not set yet).
  const profileRows = await db
    .select()
    .from(taxProfiles)
    .where(eq(taxProfiles.sessionId, sessionId));
  const filerStatus: 'filer' | 'non-filer' =
    profileRows[0]?.filerStatus === 'non-filer' ? 'non-filer' : 'filer';

  // Fetch live ticks for unique symbols only.
  const uniqueSymbols = Array.from(new Set(lots.map((l) => l.symbol)));
  const tickResults = await Promise.all(
    uniqueSymbols.map(async (symbol) => {
      try {
        const tick = await PSXApi.getTick('REG', symbol);
        return [symbol, tick] as const;
      } catch {
        return [symbol, null] as const;
      }
    }),
  );
  const tickBySymbol = new Map<string, Tick | null>(tickResults);

  const today = new Date();

  const enriched = await Promise.all(
    lots.map(async (lot) => {
      const tick = tickBySymbol.get(lot.symbol) ?? null;
      const currentPrice = tick?.price ?? null;
      const holdingDays = daysBetween(lot.acquisitionDate, today);
      const cgtRateIfSoldToday = await lookupCgtRate(
        lot.acquisitionRegime as Parameters<typeof lookupCgtRate>[0],
        holdingDays,
        filerStatus,
      );

      let currentValue: number | null = null;
      let costBasisIfSoldToday: number | null = null;
      let proceedsIfSoldToday: number | null = null;
      let unrealizedGain: number | null = null;
      let unrealizedGainPercent: number | null = null;
      let projectedCgtIfSoldToday: number | null = null;

      if (currentPrice !== null && Number.isFinite(currentPrice)) {
        currentValue = lot.quantityRemaining * currentPrice;
        costBasisIfSoldToday = lot.quantityRemaining * lot.costPerShare * (1 + NCCPL_EXPENSE_RATE);
        proceedsIfSoldToday = lot.quantityRemaining * currentPrice * (1 - NCCPL_EXPENSE_RATE);
        unrealizedGain = proceedsIfSoldToday - costBasisIfSoldToday;
        const investedRaw = lot.quantityRemaining * lot.costPerShare;
        unrealizedGainPercent = investedRaw > 0 ? unrealizedGain / investedRaw : 0;
        projectedCgtIfSoldToday = unrealizedGain > 0 ? unrealizedGain * cgtRateIfSoldToday : 0;
      }

      return {
        ...lot,
        currentPrice,
        currentValue,
        costBasisIfSoldToday,
        proceedsIfSoldToday,
        unrealizedGain,
        unrealizedGainPercent,
        holdingDays,
        cgtRateIfSoldToday,
        projectedCgtIfSoldToday,
        priceError: tick === null ? `Unable to load ${lot.symbol}` : null,
      };
    }),
  );

  res.json({
    lots: enriched,
    filerStatus,
    asOf: today.getTime(),
    backfilled,
    ...(backfilled ? { notice: BACKFILL_NOTICE } : {}),
  });
});

export default router;
