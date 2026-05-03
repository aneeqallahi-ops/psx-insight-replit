import { Router } from 'express';
import { PSXApi } from '../lib/psx-api';
import { describeMarketStatus, describeMarketStatusFromSchedule } from '../lib/market-status';
import type { MarketStats, SectorData } from '../lib/types';

const router = Router();

function isMarketStats(data: unknown): data is MarketStats {
  return typeof data === 'object' && data !== null && 'totalVolume' in data && 'topGainers' in data && 'topLosers' in data;
}

function isSectorMap(data: unknown): data is Record<string, SectorData> {
  return typeof data === 'object' && data !== null && !('totalVolume' in data) && !('advances' in data);
}

// Infer market open/closed state from the timestamp of the most recent
// 1-minute kline for a liquid benchmark symbol. If the latest candle is
// within 10 minutes, the market is actively trading. This uses real API
// data rather than a pure schedule estimate.
const MARKET_OPEN_THRESHOLD_MS = 10 * 60 * 1000;
const MARKET_STATUS_PROBE_SYMBOL = 'LUCK';

router.get('/market/status', async (req, res) => {
  try {
    const [apiHealthResult, klinesResult] = await Promise.allSettled([
      PSXApi.getStatus(),
      PSXApi.getKlines(MARKET_STATUS_PROBE_SYMBOL, '1m', { limit: 1 }),
    ]);

    const apiHealthy = apiHealthResult.status === 'fulfilled';
    const klines = klinesResult.status === 'fulfilled' ? klinesResult.value : [];
    const latestCandle = klines.length > 0 ? klines[klines.length - 1] : null;

    if (latestCandle) {
      const ageMs = Date.now() - latestCandle.timestamp;
      const isOpen = ageMs < MARKET_OPEN_THRESHOLD_MS;
      const label = isOpen ? 'Market open' : 'Market closed';
      res.json({
        status: isOpen ? 'OPN' : 'CLS',
        isOpen,
        label,
        timestamp: latestCandle.timestamp,
        lastTradeAgeMs: ageMs,
        source: 'psx-api',
        apiStatus: apiHealthy ? (apiHealthResult.value as { status: string }).status : 'unreachable',
        updatedAt: Date.now(),
      });
    } else {
      // Klines unavailable — fall back to schedule + API health indicator
      const schedule = describeMarketStatusFromSchedule();
      res.json({
        ...schedule,
        source: apiHealthy ? 'psx-api-schedule-fallback' : 'schedule-fallback',
        apiStatus: apiHealthy ? (apiHealthResult.value as { status: string }).status : 'unreachable',
        warning: 'Could not fetch recent klines to confirm market state; using schedule',
        updatedAt: Date.now(),
      });
    }
  } catch (error) {
    const fallback = describeMarketStatusFromSchedule();
    res.json({
      ...fallback,
      source: 'schedule-fallback',
      warning: error instanceof Error ? error.message : 'Unable to reach PSX API',
      updatedAt: Date.now(),
    });
  }
});

router.get('/market/overview', async (req, res) => {
  const scope = req.query.scope === 'kse100' ? 'kse100' : 'all';

  try {
    const [stats, symbols, sectors, statusResult] = await Promise.all([
      PSXApi.getStats('REG'),
      PSXApi.getSymbols(),
      PSXApi.getStats('sectors').catch(() => null),
      PSXApi.getStatus().catch(() => null),
    ]);

    if (!isMarketStats(stats)) {
      res.status(502).json({ error: 'Unexpected market stats response' });
      return;
    }

    // KSE-100 membership is derived from the /api/stats/sectors endpoint
    // (symbols listed under each sector). This is an approximation — the PSX
    // direct constituent list at dps.psx.com.pk is blocked in this environment.
    let kse100Symbols: string[] = [];
    if (isSectorMap(sectors)) {
      for (const [, data] of Object.entries(sectors)) {
        kse100Symbols = kse100Symbols.concat(data.symbols);
      }
    }

    const scopedSymbols = scope === 'kse100' && kse100Symbols.length > 0
      ? kse100Symbols
      : symbols;

    const symbolsCount = scopedSymbols.length;

    let scopedStats = stats;
    if (scope === 'kse100' && kse100Symbols.length > 0) {
      const set = new Set(kse100Symbols);
      const fGainers = stats.topGainers.filter((m) => set.has(m.symbol));
      const fLosers = stats.topLosers.filter((m) => set.has(m.symbol));
      const totalVolume = fGainers.concat(fLosers).reduce((s, m) => s + (m.volume || 0), 0) || stats.totalVolume;
      const totalValue = fGainers.concat(fLosers).reduce((s, m) => s + (m.value || 0), 0) || stats.totalValue;
      scopedStats = {
        ...stats,
        topGainers: fGainers,
        topLosers: fLosers,
        gainers: fGainers.length,
        losers: fLosers.length,
        unchanged: Math.max(0, kse100Symbols.length - fGainers.length - fLosers.length),
        symbolCount: kse100Symbols.length,
        totalVolume,
        totalValue,
      };
    }

    const asOfTimestamp = statusResult?.timestamp ?? null;
    res.json({ stats: scopedStats, symbolsCount, scope, symbols: symbols.length, asOfTimestamp, updatedAt: Date.now() });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Unable to load market overview' });
  }
});

router.get('/market/index', async (req, res) => {
  const code = (req.query.code as string)?.toUpperCase() || 'KSE100';
  try {
    const klines = await PSXApi.getKlines(code, '1d', { limit: 2 });
    if (!klines || klines.length === 0) {
      res.status(502).json({ error: `No data for ${code}` });
      return;
    }
    const latest = klines[klines.length - 1];
    const previous = klines.length > 1 ? klines[klines.length - 2] : null;
    const close = latest.close;
    const change = previous ? close - previous.close : 0;
    const changePercent = previous && previous.close ? change / previous.close : 0;
    res.json({
      code,
      close,
      open: latest.open,
      high: latest.high,
      low: latest.low,
      volume: latest.volume,
      change,
      changePercent,
      asOfTimestamp: latest.timestamp,
      updatedAt: Date.now(),
    });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Unable to load index' });
  }
});

router.get('/market/movers', async (req, res) => {
  const range = (req.query.range as string) === '1w' ? '1w' : (req.query.range as string) === '1m' ? '1m' : '1d';
  const scope = req.query.scope === 'kse100' ? 'kse100' : 'all';

  try {
    const [stats, sectors] = await Promise.all([
      PSXApi.getStats('REG'),
      scope === 'kse100' ? PSXApi.getStats('sectors').catch(() => null) : Promise.resolve(null),
    ]);
    if (!isMarketStats(stats)) {
      res.status(502).json({ error: 'Unexpected market stats response' });
      return;
    }

    let kse100Set: Set<string> | null = null;
    if (scope === 'kse100' && isSectorMap(sectors)) {
      const list: string[] = [];
      for (const [, data] of Object.entries(sectors)) list.push(...data.symbols);
      kse100Set = new Set(list);
    }
    const inScope = (sym: string) => (kse100Set ? kse100Set.has(sym) : true);

    if (range === '1d') {
      res.json({
        range,
        scope,
        gainers: stats.topGainers.filter((m) => inScope(m.symbol)),
        losers: stats.topLosers.filter((m) => inScope(m.symbol)),
        updatedAt: Date.now(),
      });
      return;
    }

    const lookback = range === '1w' ? 6 : 23;
    const pool = Array.from(new Set([...stats.topGainers, ...stats.topLosers].map((m) => m.symbol).filter(inScope)));
    const enriched = await Promise.all(
      pool.map(async (symbol) => {
        try {
          const klines = await PSXApi.getKlines(symbol, '1d', { limit: lookback });
          if (!klines || klines.length < 2) return null;
          const last = klines[klines.length - 1];
          const first = klines[0];
          if (!first.close) return null;
          const change = last.close - first.close;
          const changePercent = change / first.close;
          const volume = klines.reduce((sum, k) => sum + (k.volume || 0), 0);
          return {
            symbol,
            price: last.close,
            change,
            changePercent,
            volume,
            value: 0,
          };
        } catch {
          return null;
        }
      }),
    );
    const valid = enriched.filter((m): m is NonNullable<typeof m> => m !== null);
    const gainers = [...valid].sort((a, b) => b.changePercent - a.changePercent).slice(0, 15);
    const losers = [...valid].sort((a, b) => a.changePercent - b.changePercent).slice(0, 15);
    res.json({ range, scope, gainers, losers, updatedAt: Date.now() });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Unable to load movers' });
  }
});

router.get('/market/sectors', async (req, res) => {
  try {
    const sectors = await PSXApi.getStats('sectors');
    if (!isSectorMap(sectors)) {
      res.status(502).json({ error: 'Unexpected sector stats response' });
      return;
    }
    res.json({ sectors, updatedAt: Date.now() });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Unable to load sector stats' });
  }
});

router.get('/market/ticks', async (req, res) => {
  const requested = ((req.query.symbols as string) ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 60);

  if (!requested.length) {
    res.json({ ticks: [], updatedAt: Date.now() });
    return;
  }

  try {
    const stats = await PSXApi.getStats('REG');
    if (!isMarketStats(stats)) {
      res.json({ ticks: [], updatedAt: Date.now() });
      return;
    }

    const wanted = new Set(requested);
    const allMovers = [...stats.topGainers, ...stats.topLosers];
    const seen = new Set<string>();
    const ticks = allMovers
      .filter((m) => {
        if (!wanted.has(m.symbol) || seen.has(m.symbol)) return false;
        seen.add(m.symbol);
        return true;
      })
      .map((m) => ({
        symbol: m.symbol,
        price: m.price,
        change: m.change,
        changePercent: m.changePercent,
        volume: m.volume,
        value: m.value,
      }));

    res.json({ ticks, updatedAt: Date.now() });
  } catch (error) {
    res.json({ ticks: [], updatedAt: Date.now(), warning: error instanceof Error ? error.message : 'Ticks unavailable' });
  }
});

export default router;
