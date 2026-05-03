import { Router } from 'express';
import { PSXApi } from '../lib/psx-api';
import type { Timeframe } from '../lib/types';

const router = Router();
const timeframes = new Set<Timeframe>(['1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M']);

router.get('/stock/detail', async (req, res) => {
  const symbol = (req.query.symbol as string)?.toUpperCase();
  const requested = req.query.timeframe as string ?? '1d';
  const timeframe = timeframes.has(requested as Timeframe) ? (requested as Timeframe) : '1d';

  if (!symbol) {
    res.status(400).json({ error: 'Missing symbol' });
    return;
  }

  try {
    const [fundamentals, company, dividends, klines] = await Promise.allSettled([
      PSXApi.getFundamentals(symbol),
      PSXApi.getCompany(symbol),
      PSXApi.getDividends(symbol),
      PSXApi.getKlines(symbol, timeframe, { limit: 100 }),
    ]);

    const fund = fundamentals.status === 'fulfilled' ? fundamentals.value : null;
    const comp = company.status === 'fulfilled' ? company.value : null;
    const divs = dividends.status === 'fulfilled' ? dividends.value : [];
    const klineData = klines.status === 'fulfilled' ? klines.value : [];

    if (!fund && !klineData.length) {
      const reason = fundamentals.status === 'rejected' ? fundamentals.reason : 'No data available';
      res.status(502).json({ error: reason instanceof Error ? reason.message : String(reason) });
      return;
    }

    const syntheticTick = fund ? {
      symbol,
      market: 'REG' as const,
      st: 'CLS' as const,
      price: fund.price,
      change: 0,
      changePercent: fund.changePercent / 100,
      volume: fund.volume30Avg,
      trades: 0,
      value: 0,
      high: fund.price,
      low: fund.price,
      bid: fund.price,
      ask: fund.price,
      timestamp: fund.timestamp ? new Date(fund.timestamp).getTime() : Date.now(),
    } : null;

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
    res.status(502).json({ error: error instanceof Error ? error.message : `Unable to load ${symbol}` });
  }
});

router.get('/stock/tick', async (req, res) => {
  const symbol = (req.query.symbol as string)?.toUpperCase();
  if (!symbol) {
    res.status(400).json({ error: 'Missing symbol' });
    return;
  }
  try {
    const fundamentals = await PSXApi.getFundamentals(symbol);
    const syntheticTick = {
      symbol,
      market: 'REG' as const,
      st: 'CLS' as const,
      price: fundamentals.price,
      change: 0,
      changePercent: fundamentals.changePercent / 100,
      volume: fundamentals.volume30Avg,
      trades: 0,
      value: 0,
      high: fundamentals.price,
      low: fundamentals.price,
      bid: fundamentals.price,
      ask: fundamentals.price,
      timestamp: fundamentals.timestamp ? new Date(fundamentals.timestamp).getTime() : Date.now(),
    };
    res.json({ tick: syntheticTick, updatedAt: Date.now() });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : `Unable to load ${symbol} tick` });
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
    res.status(502).json({ error: error instanceof Error ? error.message : `Unable to load ${symbol} chart` });
  }
});

export default router;
