import { Router } from 'express';
import { PSXApi } from '../lib/psx-api';
import { psxWs } from '../lib/psx-ws';
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
    const [stats, symbols, statusResult] = await Promise.all([
      PSXApi.getStats('REG', scope),
      PSXApi.getSymbols().catch(() => [] as string[]),
      PSXApi.getStatus().catch(() => null),
    ]);

    if (!isMarketStats(stats)) {
      res.status(502).json({ error: 'Unexpected market stats response' });
      return;
    }

    // `stats` is already aggregated for the requested scope (all market or the
    // exact KSE-100 constituents), so every count/total reflects the filter.
    const asOfTimestamp = statusResult?.timestamp ?? null;
    res.json({
      stats,
      symbolsCount: stats.symbolCount,
      scope,
      symbols: symbols.length,
      asOfTimestamp,
      updatedAt: Date.now(),
    });
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
    const stats = await PSXApi.getStats('REG', scope);
    if (!isMarketStats(stats)) {
      res.status(502).json({ error: 'Unexpected market stats response' });
      return;
    }

    if (range === '1d') {
      // `stats` is already scoped, so its top movers are the scoped movers.
      res.json({ range, scope, gainers: stats.topGainers, losers: stats.topLosers, updatedAt: Date.now() });
      return;
    }

    const lookback = range === '1w' ? 6 : 23;
    const pool = Array.from(new Set([...stats.topGainers, ...stats.topLosers].map((m) => m.symbol)));
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

// Diagnostics for the realtime PSX WebSocket connection (does it connect, what
// has it received). Useful to verify the live-data pipeline without waiting for
// market hours.
router.get('/market/ws-status', (_req, res) => {
  res.json({ ...psxWs.status(), updatedAt: Date.now() });
});

// Diagnostics: can this server actually reach the PSX Data Portal? Surfaces the
// underlying network error cause (ECONNREFUSED/ETIMEDOUT/TLS/etc.) so we can
// tell a hard egress block from a fixable issue.
router.get('/market/portal-debug', async (_req, res) => {
  const targets = [
    'https://dps.psx.com.pk/market-watch',
    'https://psxterminal.com/api/status',
  ];
  const results = [];
  for (const url of targets) {
    const started = Date.now();
    try {
      const r = await fetch(url, {
        headers: { Accept: 'text/html', 'User-Agent': 'PSX-Insight/1.0', 'X-Requested-With': 'XMLHttpRequest' },
        signal: AbortSignal.timeout(15_000),
      });
      const text = await r.text();
      results.push({ url, ok: true, status: r.status, bytes: text.length, ms: Date.now() - started });
    } catch (err) {
      const e = err as { name?: string; message?: string; cause?: { name?: string; code?: string; message?: string } };
      results.push({
        url, ok: false, ms: Date.now() - started,
        name: e?.name, message: e?.message,
        cause: e?.cause ? { name: e.cause.name, code: e.cause.code, message: e.cause.message } : null,
      });
    }
  }
  res.json({ results, updatedAt: Date.now() });
});

export default router;
