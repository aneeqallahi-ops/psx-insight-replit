import { Router } from 'express';
import { PSXApi } from '../lib/psx-api';
import { describeMarketStatusFromSchedule } from '../lib/market-status';
import { answerIntradayQuestion } from '../lib/agent/intraday-qa';
import { checkIpLimit } from '../lib/ip-rate-limit';
import { sseSetup, sseSend } from '../lib/sse';
import { getMarketRows, type MarketRow } from '../lib/psx-portal';
import { getCompanyData, toFundamentals, toCompanyInfo, type PsxCompanyData } from '../lib/psx-company';
import { getPortalKlines } from '../lib/psx-timeseries';
import { getPayouts } from '../lib/psx-payouts';
import type { Fundamentals, MarketState, MarketStats, Timeframe, Tick } from '../lib/types';

function tickFromCompanyData(data: PsxCompanyData): Tick | null {
  if (data.price == null) return null;
  const schedule = describeMarketStatusFromSchedule();
  return {
    symbol: data.symbol,
    market: 'REG',
    st: schedule.isOpen ? 'OPN' : 'CLS',
    price: data.price,
    change: data.change ?? 0,
    changePercent: data.changePercent ?? 0,
    volume: data.volume ?? 0,
    trades: 0,
    value: (data.price ?? 0) * (data.volume ?? 0),
    ...(data.high != null ? { high: data.high } : {}),
    ...(data.low != null ? { low: data.low } : {}),
    timestamp: data.fetchedAt,
  };
}

function tickFromMarketRow(row: MarketRow): Tick {
  const schedule = describeMarketStatusFromSchedule();
  return {
    symbol: row.symbol,
    market: 'REG',
    st: schedule.isOpen ? 'OPN' : 'CLS',
    price: row.price,
    change: row.change,
    changePercent: row.changePercent,
    volume: row.volume,
    trades: 0,
    value: row.value,
    timestamp: Date.now(),
  };
}

const router = Router();
const timeframes = new Set<Timeframe>(['1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M']);
// Intraday timeframes offered to the public Q&A endpoint.
const askTimeframes = new Set<Timeframe>(['1m', '5m', '15m']);

function isMarketStats(data: unknown): data is MarketStats {
  return (
    typeof data === 'object' &&
    data !== null &&
    'totalVolume' in data &&
    'topGainers' in data &&
    'topLosers' in data
  );
}

function buildSyntheticTick(
  symbol: string,
  fund: Fundamentals,
  statsData: MarketStats | null,
  high?: number | null,
  low?: number | null,
) {
  // Try to find symbol in bulk stats movers for real intraday change/volume data.
  const allMovers = statsData ? [...statsData.topGainers, ...statsData.topLosers] : [];
  const seen = new Set<string>();
  const mover = allMovers.find((m) => {
    if (seen.has(m.symbol)) return false;
    seen.add(m.symbol);
    return m.symbol === symbol;
  }) ?? null;

  const price = fund.price;
  // changePercent from fundamentals feed is in percent units (e.g. 2.5 → 0.025)
  const changePercent = mover ? mover.changePercent : fund.changePercent / 100;
  const change = mover ? mover.change : +(price * changePercent).toFixed(2);
  const volume = mover ? mover.volume : fund.volume30Avg;
  const value = mover ? mover.value : 0;

  const schedule = describeMarketStatusFromSchedule();
  const st: MarketState = schedule.isOpen ? 'OPN' : 'CLS';

  return {
    symbol,
    market: 'REG' as const,
    st,
    price,
    change,
    changePercent,
    volume,
    trades: 0,
    value,
    ...(high != null ? { high } : {}),
    ...(low != null ? { low } : {}),
    timestamp: fund.timestamp ? new Date(fund.timestamp).getTime() : Date.now(),
  };
}

router.get('/stock/detail', async (req, res) => {
  const symbol = (req.query.symbol as string)?.toUpperCase();
  const requested = req.query.timeframe as string ?? '1d';
  const timeframe = timeframes.has(requested as Timeframe) ? (requested as Timeframe) : '1d';

  if (!symbol) {
    res.status(400).json({ error: 'Missing symbol' });
    return;
  }

  try {
    // Primary source: PSX portal — company page, timeseries, payouts.
    // Secondary: psxterminal.com for anything the portal doesn't provide.
    const [portalR, portalKlinesR, portalPayoutsR, fundamentalsR, companyR, dividendsR, klinesR, statsR] = await Promise.allSettled([
      getCompanyData(symbol),
      getPortalKlines(symbol, timeframe, 100),
      getPayouts(symbol),
      PSXApi.getFundamentals(symbol),
      PSXApi.getCompany(symbol),
      PSXApi.getDividends(symbol),
      PSXApi.getKlines(symbol, timeframe, { limit: 100 }),
      PSXApi.getStats('REG'),
    ]);

    const portal = portalR.status === 'fulfilled' ? portalR.value : null;
    // Prefer portal-derived fundamentals/company info; fall back to psxterminal.
    const fund = portal
      ? toFundamentals(portal)
      : fundamentalsR.status === 'fulfilled' ? fundamentalsR.value : null;
    const comp = portal
      ? toCompanyInfo(portal)
      : companyR.status === 'fulfilled' ? companyR.value : null;

    // Prefer PSX portal dividends (real payouts history). Fall back to psxterminal.
    const portalDivs = portalPayoutsR.status === 'fulfilled' ? portalPayoutsR.value : [];
    const psxTermDivs = dividendsR.status === 'fulfilled' ? dividendsR.value : [];
    const divs = portalDivs.length > 0 ? portalDivs : psxTermDivs;

    // Prefer PSX portal klines (real historical data). Fall back to psxterminal.
    const portalKlines = portalKlinesR.status === 'fulfilled' ? portalKlinesR.value : [];
    const psxTermKlines = klinesR.status === 'fulfilled' ? klinesR.value : [];
    const klineData = portalKlines.length > 0 ? portalKlines : psxTermKlines;

    const statsData =
      statsR.status === 'fulfilled' && isMarketStats(statsR.value) ? statsR.value : null;

    // Use today's kline high/low only if the latest candle is from today's session.
    const latestKline = klineData.length > 0 ? klineData[klineData.length - 1] : null;
    let klineHigh: number | null = null;
    let klineLow: number | null = null;
    if (latestKline) {
      const candleDate = new Date(latestKline.timestamp).toDateString();
      if (candleDate === new Date().toDateString()) {
        klineHigh = latestKline.high;
        klineLow = latestKline.low;
      }
    }

    // Prefer PSX portal per-symbol tick (has real open/high/low/volume for the
    // symbol). Fall back to psxterminal synthetic tick, then to market-watch.
    let syntheticTick: Tick | null = portal ? tickFromCompanyData(portal) : null;
    let portalFallbackUsed = Boolean(syntheticTick);
    if (!syntheticTick && fund) {
      syntheticTick = buildSyntheticTick(symbol, fund, statsData, klineHigh, klineLow);
      portalFallbackUsed = false;
    }
    if (!syntheticTick) {
      try {
        const rows = await getMarketRows();
        const row = rows.find((r) => r.symbol === symbol);
        if (row) {
          syntheticTick = tickFromMarketRow(row);
          portalFallbackUsed = true;
        }
      } catch {
        // Portal is also down — nothing more we can do.
      }
    }

    // Surface upstream failures as a soft warning so the page still renders
    // with whatever partial data we did get, instead of a hard 502.
    const rejections = [
      fundamentalsR.status === 'rejected' ? `fundamentals: ${String(fundamentalsR.reason)}` : null,
      companyR.status === 'rejected' ? `company: ${String(companyR.reason)}` : null,
      dividendsR.status === 'rejected' ? `dividends: ${String(dividendsR.reason)}` : null,
      klinesR.status === 'rejected' ? `klines: ${String(klinesR.reason)}` : null,
    ].filter(Boolean);
    const warning = !syntheticTick && rejections.length > 0
      ? `Upstream data source is temporarily unavailable (${rejections.join('; ')})`
      : portalFallbackUsed
        ? 'Primary data source unavailable — showing last snapshot from PSX portal.'
        : undefined;

    res.json({
      tick: syntheticTick,
      fundamentals: fund,
      company: comp,
      dividends: divs,
      klines: klineData,
      timeframe,
      updatedAt: Date.now(),
      // PSX portal only fields (financials + ratios tables).
      financials: portal?.financials ?? [],
      ratios: portal?.ratios ?? [],
      ...(warning ? { warning } : {}),
    });
  } catch (error) {
    res
      .status(502)
      .json({ error: error instanceof Error ? error.message : `Unable to load ${symbol}` });
  }
});

router.get('/stock/tick', async (req, res) => {
  const symbol = (req.query.symbol as string)?.toUpperCase();
  if (!symbol) {
    res.status(400).json({ error: 'Missing symbol' });
    return;
  }
  try {
    // Primary: PSX portal per-symbol page. Secondary: psxterminal.
    const [portalR, fundamentalsR, statsR] = await Promise.allSettled([
      getCompanyData(symbol),
      PSXApi.getFundamentals(symbol),
      PSXApi.getStats('REG'),
    ]);

    if (portalR.status === 'fulfilled') {
      const tick = tickFromCompanyData(portalR.value);
      if (tick) {
        res.json({ tick, updatedAt: Date.now() });
        return;
      }
    }

    const statsData =
      statsR.status === 'fulfilled' && isMarketStats(statsR.value) ? statsR.value : null;

    if (fundamentalsR.status === 'fulfilled') {
      const tick = buildSyntheticTick(symbol, fundamentalsR.value, statsData);
      res.json({ tick, updatedAt: Date.now() });
      return;
    }

    // Last-resort: PSX Market Watch snapshot.
    try {
      const rows = await getMarketRows();
      const row = rows.find((r) => r.symbol === symbol);
      if (row) {
        res.json({
          tick: tickFromMarketRow(row),
          updatedAt: Date.now(),
          warning: 'Primary data source unavailable — showing PSX portal snapshot.',
        });
        return;
      }
    } catch {
      // fall through to error
    }

    throw fundamentalsR.status === 'rejected' && fundamentalsR.reason instanceof Error
      ? fundamentalsR.reason
      : new Error(`Unable to load ${symbol} tick`);
  } catch (error) {
    res
      .status(502)
      .json({
        error: error instanceof Error ? error.message : `Unable to load ${symbol} tick`,
      });
  }
});

router.get('/stock/klines', async (req, res) => {
  const symbol = (req.query.symbol as string)?.toUpperCase();
  const requested = req.query.timeframe as string ?? '1d';
  const timeframe = timeframes.has(requested as Timeframe) ? (requested as Timeframe) : '1d';

  if (!symbol) {
    res.status(400).json({ error: 'Missing symbol' });
    return;
  }
  try {
    // Portal first, psxterminal as fallback.
    let klines: Awaited<ReturnType<typeof getPortalKlines>> = [];
    try {
      klines = await getPortalKlines(symbol, timeframe, 100);
    } catch { /* try psxterminal */ }
    if (klines.length === 0) {
      klines = await PSXApi.getKlines(symbol, timeframe, { limit: 100 });
    }
    res.json({ klines, timeframe, updatedAt: Date.now() });
  } catch (error) {
    res
      .status(502)
      .json({
        error: error instanceof Error ? error.message : `Unable to load ${symbol} chart`,
      });
  }
});

// Public, single-shot intraday Q&A. A visitor asks a natural-language question
// about this stock's intraday price/volume; we answer (streamed via SSE) using
// deterministic stats + the LLM. See lib/agent/intraday-qa.ts.
router.post('/stock/ask/:symbol', async (req, res) => {
  const symbol = req.params.symbol?.toUpperCase();
  if (!symbol || !/^[A-Z0-9-]{1,20}$/.test(symbol)) {
    res.status(400).json({ error: 'Invalid symbol' });
    return;
  }

  const body = (req.body ?? {}) as { question?: unknown; timeframe?: unknown };
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) {
    res.status(400).json({ error: 'Missing question' });
    return;
  }
  if (question.length > 500) {
    res.status(400).json({ error: 'Question too long (max 500 characters)' });
    return;
  }
  const requestedTf = typeof body.timeframe === 'string' ? body.timeframe : '5m';
  const timeframe: Timeframe = askTimeframes.has(requestedTf as Timeframe)
    ? (requestedTf as Timeframe)
    : '5m';

  // Per-IP guardrail (generous; the global limiter in lib/agent/llm.ts is the hard ceiling).
  const ip = req.ip ?? 'unknown';
  const limit = checkIpLimit(ip, [
    { max: 20, windowMs: 60_000 },
    { max: 200, windowMs: 60 * 60_000 },
  ]);
  if (!limit.ok) {
    res.status(429).json({ error: `Too many questions. Try again in ${limit.retryAfterSec}s.` });
    return;
  }

  sseSetup(res);
  const abortController = new AbortController();
  // Abort only on a genuine client disconnect. We listen on `res` (response
  // stream) rather than `req`, because for a POST that carries a body `req`'s
  // 'close' fires as soon as the body is consumed — which would abort the LLM
  // call before it even starts.
  res.on('close', () => {
    if (!res.writableEnded) abortController.abort();
  });

  try {
    const result = await answerIntradayQuestion(symbol, question, {
      timeframe,
      signal: abortController.signal,
      onToken: (text) => sseSend(res, 'token', { text }),
      onMeta: (meta) => sseSend(res, 'meta', meta),
    });
    sseSend(res, 'done', { ok: true, asOf: result.asOf, isStale: result.isStale });
  } catch (err) {
    if (!abortController.signal.aborted) {
      sseSend(res, 'error', { error: err instanceof Error ? err.message : 'Failed to answer question' });
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
});

export default router;
