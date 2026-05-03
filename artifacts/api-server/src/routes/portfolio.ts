import { Router } from 'express';
import { PSXApi } from '../lib/psx-api';
import type { Dividend, Fundamentals, Tick } from '../lib/types';
import { db } from '@workspace/db';
import { portfolioHoldings, taxProfiles } from '@workspace/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

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

export default router;
