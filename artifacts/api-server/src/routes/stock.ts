import { Router } from 'express';
import { PSXApi } from '../lib/psx-api';
import { describeMarketStatusFromSchedule } from '../lib/market-status';
import { answerIntradayQuestion } from '../lib/agent/intraday-qa';
import { checkIpLimit } from '../lib/ip-rate-limit';
import { sseSetup, sseSend } from '../lib/sse';
import type { Fundamentals, MarketState, MarketStats, Timeframe } from '../lib/types';

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
    const [fundamentalsR, companyR, dividendsR, klinesR, statsR] = await Promise.allSettled([
      PSXApi.getFundamentals(symbol),
      PSXApi.getCompany(symbol),
      PSXApi.getDividends(symbol),
      PSXApi.getKlines(symbol, timeframe, { limit: 100 }),
      PSXApi.getStats('REG'),
    ]);

    const fund = fundamentalsR.status === 'fulfilled' ? fundamentalsR.value : null;
    const comp = companyR.status === 'fulfilled' ? companyR.value : null;
    const divs = dividendsR.status === 'fulfilled' ? dividendsR.value : [];
    const klineData = klinesR.status === 'fulfilled' ? klinesR.value : [];
    const statsData =
      statsR.status === 'fulfilled' && isMarketStats(statsR.value) ? statsR.value : null;

    if (!fund && !klineData.length) {
      const reason =
        fundamentalsR.status === 'rejected' ? fundamentalsR.reason : 'No data available';
      res.status(502).json({ error: reason instanceof Error ? reason.message : String(reason) });
      return;
    }

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

    const syntheticTick = fund
      ? buildSyntheticTick(symbol, fund, statsData, klineHigh, klineLow)
      : null;

    res.json({
      tick: syntheticTick,
      fundamentals: fund,
      company: comp,
      dividends: divs,
      klines: klineData,
      timeframe,
      updatedAt: Date.now(),
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
    const [fundamentalsR, statsR] = await Promise.allSettled([
      PSXApi.getFundamentals(symbol),
      PSXApi.getStats('REG'),
    ]);

    if (fundamentalsR.status === 'rejected') {
      throw fundamentalsR.reason instanceof Error
        ? fundamentalsR.reason
        : new Error(String(fundamentalsR.reason));
    }
    const fund = fundamentalsR.value;
    const statsData =
      statsR.status === 'fulfilled' && isMarketStats(statsR.value) ? statsR.value : null;

    const tick = buildSyntheticTick(symbol, fund, statsData);
    res.json({ tick, updatedAt: Date.now() });
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
    const klines = await PSXApi.getKlines(symbol, timeframe, { limit: 100 });
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
