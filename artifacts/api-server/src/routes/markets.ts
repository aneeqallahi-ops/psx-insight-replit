import { Router } from 'express';
import { PSXApi } from '../lib/psx-api';
import type { MarketStats, SectorData } from '../lib/types';

const router = Router();

function isMarketStats(data: unknown): data is MarketStats {
  return typeof data === 'object' && data !== null && 'totalVolume' in data && 'topGainers' in data;
}

function isSectorMap(data: unknown): data is Record<string, SectorData> {
  return typeof data === 'object' && data !== null && !('totalVolume' in data) && !('advances' in data);
}

function makeSectorLookup(sectors: Record<string, SectorData>) {
  const lookup = new Map<string, string>();
  for (const [sector, data] of Object.entries(sectors)) {
    for (const symbol of data.symbols) {
      lookup.set(symbol, sector.replace(/_/g, ' '));
    }
  }
  return lookup;
}

router.get('/markets', async (req, res) => {
  try {
    const scope = req.query.scope === 'kse100' ? 'kse100' : 'all';
    const [symbols, statsResult, sectorsResult] = await Promise.all([
      PSXApi.getSymbols(),
      PSXApi.getStats('REG'),
      PSXApi.getStats('sectors'),
    ]);

    if (!isMarketStats(statsResult) || !isSectorMap(sectorsResult)) {
      res.status(502).json({ error: 'Unexpected market response' });
      return;
    }

    const moverLookup = new Map([
      ...statsResult.topGainers.map((m) => [m.symbol, m] as const),
      ...statsResult.topLosers.map((m) => [m.symbol, m] as const),
    ]);
    const sectorLookup = makeSectorLookup(sectorsResult);

    // KSE-100 membership is approximated from the sectors endpoint (symbols
    // grouped under each sector). The canonical constituent list at
    // dps.psx.com.pk is blocked in this environment (DDoS protection 462).
    const kse100Symbols = new Set<string>();
    for (const [, data] of Object.entries(sectorsResult)) {
      for (const symbol of data.symbols) {
        kse100Symbols.add(symbol);
      }
    }

    const sourceSymbols = scope === 'kse100'
      ? symbols.filter((s) => kse100Symbols.has(s))
      : symbols;

    res.json({
      rows: sourceSymbols.map((symbol) => {
        const mover = moverLookup.get(symbol);
        return {
          symbol,
          price: mover?.price ?? null,
          change: mover?.change ?? null,
          changePercent: mover?.changePercent ?? null,
          volume: mover?.volume ?? null,
          value: mover?.value ?? null,
          sector: sectorLookup.get(symbol) ?? 'Unclassified',
          isKSE100: kse100Symbols.has(symbol),
        };
      }),
      scope,
      updatedAt: Date.now(),
    });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Unable to load markets' });
  }
});

router.get('/markets/enrich', async (req, res) => {
  const symbols = ((req.query.symbols as string) ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 60);

  if (!symbols.length) {
    res.json({ enriched: {}, updatedAt: Date.now() });
    return;
  }

  const results = await Promise.allSettled(
    symbols.map((symbol) => PSXApi.getFundamentals(symbol)),
  );

  const enriched: Record<string, { price: number; changePercent: number }> = {};
  for (let i = 0; i < symbols.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      const f = result.value;
      enriched[f.symbol] = {
        price: f.price,
        changePercent: f.changePercent / 100,
      };
    }
  }

  res.json({ enriched, updatedAt: Date.now() });
});

export default router;
