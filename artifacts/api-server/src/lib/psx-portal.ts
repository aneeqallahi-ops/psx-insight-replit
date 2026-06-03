// Market stats sourced from PSX's official Data Portal (dps.psx.com.pk).
//
// psxterminal.com removed its REST /api/stats endpoint, so we go to the primary
// source instead: the Data Portal "Market Watch" page lists every listed
// security (symbol, sector, index memberships, LDCP, open/high/low, current,
// volume). From that single snapshot we reconstruct the MarketStats / breadth /
// sector aggregates the dashboard needs — and, unlike a live websocket, this
// page keeps showing the last session's data while the market is closed
// (it is ~5 min delayed during trading).
//
// Same source + parsing approach already used by psx-index.ts.

import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import type { MarketStats, SectorData, TopMover } from './types';
import { withCache } from './cache';

const DPS_BASE_URL = process.env.PSX_DPS_BASE_URL || 'https://dps.psx.com.pk';

const TOP_MOVERS_LIMIT = 50;
const MARKET_WATCH_TTL_MS = 60_000; // page is ~5 min delayed; 60s cache is plenty

export interface MarketRow {
  symbol: string;
  sector: string;
  listedIn: string[];
  ldcp: number;
  price: number;
  change: number;
  changePercent: number; // fraction (e.g. 0.0512 for +5.12%)
  volume: number;
  value: number; // approx turnover = price * volume (portal omits true value)
}

function numberFromCell($cell: cheerio.Cheerio<Element>): number {
  const raw = $cell.attr('data-order') ?? $cell.text();
  const value = Number(raw.replace(/,/g, '').replace('%', '').trim());
  return Number.isFinite(value) ? value : 0;
}

async function fetchRows(): Promise<MarketRow[]> {
  const res = await fetch(`${DPS_BASE_URL}/market-watch`, {
    headers: {
      Accept: 'text/html',
      'User-Agent': 'PSX-Insight/1.0',
      'X-Requested-With': 'XMLHttpRequest',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`PSX market-watch error: ${res.status}`);

  const $ = cheerio.load(await res.text());
  const rows: MarketRow[] = [];

  $('.tbl__body tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 11) return;

    const symbol = (cells.eq(0).attr('data-order') || cells.eq(0).text()).trim();
    if (!symbol) return;

    const ldcp = numberFromCell(cells.eq(3));
    const price = numberFromCell(cells.eq(7));
    const volume = numberFromCell(cells.eq(10));
    const change = price - ldcp;
    const changePercent = ldcp ? change / ldcp : 0;

    rows.push({
      symbol,
      sector: cells.eq(1).text().trim(),
      listedIn: cells.eq(2).text().split(',').map((s) => s.trim()).filter(Boolean),
      ldcp,
      price,
      change,
      changePercent,
      volume,
      value: price * volume,
    });
  });

  return rows;
}

/** Cached parsed Market Watch rows (full market snapshot). */
export function getMarketRows(): Promise<MarketRow[]> {
  return withCache('portal:market-watch', MARKET_WATCH_TTL_MS, fetchRows);
}

function toTopMover(r: MarketRow): TopMover {
  return {
    symbol: r.symbol,
    change: r.change,
    changePercent: r.changePercent,
    price: r.price,
    volume: r.volume,
    value: r.value,
  };
}

function aggregate(rows: MarketRow[]): MarketStats {
  let totalVolume = 0;
  let totalValue = 0;
  let gainers = 0;
  let losers = 0;
  let unchanged = 0;

  for (const r of rows) {
    totalVolume += r.volume;
    totalValue += r.value;
    if (r.change > 0) gainers += 1;
    else if (r.change < 0) losers += 1;
    else unchanged += 1;
  }

  const byPct = [...rows].sort((a, b) => b.changePercent - a.changePercent);
  const topGainers = byPct.filter((r) => r.change > 0).slice(0, TOP_MOVERS_LIMIT).map(toTopMover);
  const topLosers = byPct.filter((r) => r.change < 0).reverse().slice(0, TOP_MOVERS_LIMIT).map(toTopMover);

  return {
    totalVolume,
    totalValue,
    totalTrades: 0, // not provided by the Market Watch page
    symbolCount: rows.length,
    gainers,
    losers,
    unchanged,
    topGainers,
    topLosers,
  };
}

export const psxPortal = {
  /** MarketStats for the whole regular market (scope handled by callers). */
  async getMarketStats(): Promise<MarketStats> {
    return aggregate(await getMarketRows());
  },

  /** Exact KSE-100 membership from the "LISTED IN" column. */
  async getKse100Symbols(): Promise<string[]> {
    const rows = await getMarketRows();
    return rows.filter((r) => r.listedIn.includes('KSE100')).map((r) => r.symbol);
  },

  /** Sector aggregates keyed by sector code (replaces old /api/stats/sectors). */
  async getSectorStats(): Promise<Record<string, SectorData>> {
    const rows = await getMarketRows();
    const out: Record<string, SectorData> = {};

    for (const r of rows) {
      const key = r.sector || 'UNKNOWN';
      const s = (out[key] ??= {
        totalVolume: 0,
        totalValue: 0,
        totalTrades: 0,
        gainers: 0,
        losers: 0,
        unchanged: 0,
        avgChange: 0,
        avgChangePercent: 0,
        symbols: [],
      });
      s.totalVolume += r.volume;
      s.totalValue += r.value;
      if (r.change > 0) s.gainers += 1;
      else if (r.change < 0) s.losers += 1;
      else s.unchanged += 1;
      s.avgChange += r.change;
      s.avgChangePercent += r.changePercent;
      s.symbols.push(r.symbol);
    }

    for (const s of Object.values(out)) {
      const n = s.symbols.length || 1;
      s.avgChange /= n;
      s.avgChangePercent /= n;
    }

    return out;
  },
};
