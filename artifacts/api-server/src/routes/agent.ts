import { Router } from 'express';
import { db } from '@workspace/db';
import { portfolioHoldings } from '@workspace/db/schema';
import { eq } from 'drizzle-orm';
import { createHash } from 'crypto';
import { logger } from '../lib/logger';
import { technicalAnalyst } from '../lib/agent/analysts/technical';
import { fundamentalAnalyst } from '../lib/agent/analysts/fundamental';
import { newsAnalyst } from '../lib/agent/analysts/news';
import { synthesize, type SynthesisReport } from '../lib/agent/analysts/synthesizer';
import { reviewPortfolio, type PortfolioReviewReport } from '../lib/agent/portfolio-review';
import { generateDailyReport, type DailyMarketReport } from '../lib/agent/daily-report';
import {
  getCachedReport,
  getLatestReport,
  getReportById,
  listReports,
  putCachedReport,
} from '../lib/agent/cache';

const router = Router();

const STOCK_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const PORTFOLIO_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d
const DAILY_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function todayKey() {
  // Asia/Karachi date for the daily report key
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date());
}

function sseSetup(res: import('express').Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}

function sseSend(res: import('express').Response, event: string, data: unknown) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

router.get('/agent/analyze/:symbol/history', async (req, res) => {
  const symbol = req.params.symbol?.toUpperCase();
  if (!symbol || !/^[A-Z0-9-]{1,20}$/.test(symbol)) {
    res.status(400).json({ error: 'Invalid symbol' });
    return;
  }
  try {
    const rows = await listReports('stock', `${symbol}:`);
    const entries = rows.map((row) => {
      const payload = row.payload as Partial<SynthesisReport> | null;
      return {
        id: row.id,
        generatedAt: row.generatedAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        verdict: payload?.verdict ?? null,
        confidence: payload?.confidence ?? null,
        headline: payload?.headline ?? null,
      };
    });
    res.json({ symbol, entries });
  } catch (err) {
    logger.error({ err }, `agent.history failed for ${symbol}`);
    res.status(500).json({ error: 'Failed to load history' });
  }
});

router.get('/agent/analyze/:symbol/history/:id', async (req, res) => {
  const symbol = req.params.symbol?.toUpperCase();
  const id = Number.parseInt(req.params.id ?? '', 10);
  if (!symbol || !/^[A-Z0-9-]{1,20}$/.test(symbol)) {
    res.status(400).json({ error: 'Invalid symbol' });
    return;
  }
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  try {
    const row = await getReportById<SynthesisReport>('stock', id, `${symbol}:`);
    if (!row) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }
    res.json({
      id: row.id,
      report: row.payload,
      generatedAt: row.generatedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, `agent.history.detail failed for ${symbol}#${id}`);
    res.status(500).json({ error: 'Failed to load report' });
  }
});

router.post('/agent/analyze/:symbol', async (req, res) => {
  const symbol = req.params.symbol?.toUpperCase();
  if (!symbol || !/^[A-Z0-9-]{1,20}$/.test(symbol)) {
    res.status(400).json({ error: 'Invalid symbol' });
    return;
  }

  const cacheKey = `${symbol}:${todayKey()}`;
  const cached = await getCachedReport<SynthesisReport>('stock', cacheKey);

  if (cached) {
    res.json({
      cached: true,
      report: cached.payload,
      generatedAt: cached.generatedAt.toISOString(),
      expiresAt: cached.expiresAt.toISOString(),
    });
    return;
  }

  sseSetup(res);
  let clientGone = false;
  req.on('close', () => {
    clientGone = true;
    if (!res.writableEnded) res.end();
  });

  try {
    if (clientGone) return;
    sseSend(res, 'phase', { phase: 'gathering', message: `Pulling data for ${symbol}` });

    const [techRes, fundRes, newsRes] = await Promise.allSettled([
      (async () => {
        sseSend(res, 'phase', { phase: 'technicals', message: 'Technical analyst running' });
        const r = await technicalAnalyst(symbol);
        sseSend(res, 'analyst', { kind: 'technicals', report: r });
        return r;
      })(),
      (async () => {
        sseSend(res, 'phase', { phase: 'fundamentals', message: 'Fundamental analyst running' });
        const r = await fundamentalAnalyst(symbol);
        sseSend(res, 'analyst', { kind: 'fundamentals', report: r });
        return r;
      })(),
      (async () => {
        sseSend(res, 'phase', { phase: 'news', message: 'News analyst running' });
        const r = await newsAnalyst(symbol);
        sseSend(res, 'analyst', { kind: 'news', report: r });
        return r;
      })(),
    ]);

    const technicals =
      techRes.status === 'fulfilled'
        ? techRes.value
        : { summary: 'Technical analyst failed', signals: [], confidence: 0, citations: [] };
    const fundamentals =
      fundRes.status === 'fulfilled'
        ? fundRes.value
        : { summary: 'Fundamental analyst failed', signals: [], confidence: 0, citations: [] };
    const news =
      newsRes.status === 'fulfilled'
        ? newsRes.value
        : { summary: 'News analyst failed', signals: [], confidence: 0, citations: [] };

    sseSend(res, 'phase', { phase: 'synthesizing', message: 'Synthesizer producing verdict' });

    const report = await synthesize(symbol, technicals, fundamentals, news, (token) => {
      if (!clientGone) sseSend(res, 'token', { text: token });
    });

    await putCachedReport('stock', cacheKey, report, STOCK_TTL_MS, {
      retainGroupKeyPrefix: `${symbol}:`,
    });

    if (!clientGone) {
      sseSend(res, 'report', { report });
      sseSend(res, 'done', { ok: true });
    }
    if (!res.writableEnded) res.end();
  } catch (err) {
    logger.error({ err }, `agent.analyze failed for ${symbol}`);
    if (!clientGone) {
      sseSend(res, 'error', {
        error: err instanceof Error ? err.message : 'Analysis failed',
      });
    }
    if (!res.writableEnded) res.end();
  }
});

router.get('/agent/daily-report/history', async (_req, res) => {
  try {
    const rows = await listReports('market', '');
    const entries = rows.map((row) => {
      const payload = row.payload as Partial<DailyMarketReport> | null;
      return {
        id: row.id,
        generatedAt: row.generatedAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        asOf: payload?.asOf ?? null,
        headline: payload?.headline ?? null,
      };
    });
    res.json({ entries });
  } catch (err) {
    logger.error({ err }, 'agent.daily-report.history failed');
    res.status(500).json({ error: 'Failed to load daily report history' });
  }
});

router.get('/agent/daily-report/history/:id', async (req, res) => {
  const id = Number.parseInt(req.params.id ?? '', 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  try {
    const row = await getReportById<DailyMarketReport>('market', id);
    if (!row) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }
    res.json({
      id: row.id,
      report: row.payload,
      generatedAt: row.generatedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, `agent.daily-report.history.detail failed for #${id}`);
    res.status(500).json({ error: 'Failed to load report' });
  }
});

router.get('/agent/portfolio-review/history', async (req, res) => {
  const sessionId = req.portfolioSessionId;
  try {
    const rows = await listReports('portfolio', `${sessionId}:`);
    const entries = rows.map((row) => {
      const payload = row.payload as Partial<PortfolioReviewReport> | null;
      return {
        id: row.id,
        generatedAt: row.generatedAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        healthScore: payload?.healthScore ?? null,
        headline: payload?.headline ?? null,
        positionsAnalyzed: payload?.positionsAnalyzed ?? null,
      };
    });
    res.json({ entries });
  } catch (err) {
    logger.error({ err }, 'agent.portfolio-review.history failed');
    res.status(500).json({ error: 'Failed to load portfolio review history' });
  }
});

router.get('/agent/portfolio-review/history/:id', async (req, res) => {
  const sessionId = req.portfolioSessionId;
  const id = Number.parseInt(req.params.id ?? '', 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  try {
    const row = await getReportById<PortfolioReviewReport>('portfolio', id, `${sessionId}:`);
    if (!row) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }
    res.json({
      id: row.id,
      report: row.payload,
      generatedAt: row.generatedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, `agent.portfolio-review.history.detail failed for #${id}`);
    res.status(500).json({ error: 'Failed to load report' });
  }
});

router.post('/agent/portfolio-review', async (req, res) => {
  const sessionId = req.portfolioSessionId;
  const force = req.query.force === '1' || req.query.force === 'true';
  const holdings = await db
    .select()
    .from(portfolioHoldings)
    .where(eq(portfolioHoldings.sessionId, sessionId));

  const symbolsKey = createHash('sha1')
    .update(holdings.map((h) => `${h.symbol}:${h.shares}:${h.avgBuyPrice}`).sort().join('|'))
    .digest('hex')
    .slice(0, 16);
  const cacheKey = `${sessionId}:${symbolsKey}`;

  if (!force) {
    const cached = await getCachedReport<PortfolioReviewReport>('portfolio', cacheKey);
    if (cached) {
      res.json({
        cached: true,
        report: cached.payload,
        generatedAt: cached.generatedAt.toISOString(),
        expiresAt: cached.expiresAt.toISOString(),
      });
      return;
    }
  }

  try {
    const report = await reviewPortfolio(holdings);
    await putCachedReport('portfolio', cacheKey, report, PORTFOLIO_TTL_MS);
    res.json({
      cached: false,
      report,
      generatedAt: report.generatedAt,
      expiresAt: new Date(Date.now() + PORTFOLIO_TTL_MS).toISOString(),
    });
  } catch (err) {
    logger.error({ err }, 'agent.portfolio-review failed');
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Portfolio review failed',
    });
  }
});

router.get('/agent/daily-report', async (_req, res) => {
  const key = todayKey();
  const cached = await getCachedReport<DailyMarketReport>('market', key);
  if (cached) {
    res.json({
      cached: true,
      report: cached.payload,
      generatedAt: cached.generatedAt.toISOString(),
      expiresAt: cached.expiresAt.toISOString(),
    });
    return;
  }

  // Fall back to the most recently generated report, even if expired.
  const previousKeys: string[] = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Karachi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    previousKeys.push(fmt.format(d));
  }

  for (const prev of previousKeys) {
    const stale = await getLatestReport<DailyMarketReport>('market', prev);
    if (stale) {
      res.json({
        cached: false,
        stale: true,
        report: stale.payload,
        generatedAt: stale.generatedAt.toISOString(),
        expiresAt: stale.expiresAt.toISOString(),
        message: `Today's report is not ready yet. Showing report from ${prev}.`,
      });
      return;
    }
  }

  res.json({
    cached: false,
    report: null,
    message: 'Daily report has not been generated yet. It is produced after market close (~16:30 PKT).',
  });
});

router.post('/agent/daily-report/refresh', async (_req, res) => {
  try {
    const report = await generateDailyReport();
    const key = todayKey();
    await putCachedReport('market', key, report, DAILY_TTL_MS);
    res.json({
      cached: false,
      report,
      generatedAt: report.generatedAt,
      expiresAt: new Date(Date.now() + DAILY_TTL_MS).toISOString(),
    });
  } catch (err) {
    logger.error({ err }, 'agent.daily-report.refresh failed');
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Daily report generation failed',
    });
  }
});

export default router;
