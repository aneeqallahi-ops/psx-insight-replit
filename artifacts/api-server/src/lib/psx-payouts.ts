// Dividend / bonus / rights payout history from PSX's official Data Portal.
// The company page's Payouts section fetches an HTML fragment via AJAX. The
// table columns are: Date | Financial Results | Details | Book Closure.
// Details like "15%(F) (D)" mean 15% Final Cash Dividend, "10%(i) (D)" means
// 10% Interim Cash Dividend, "20%(B)" is a bonus, etc.

import * as cheerio from 'cheerio';
import type { Dividend } from './types';
import { withCache, TTL } from './cache';

const DPS_BASE_URL = process.env.PSX_DPS_BASE_URL || 'https://dps.psx.com.pk';

const REQUEST_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,*/*;q=0.9',
  'User-Agent': 'Mozilla/5.0 (compatible; PSX-Insight/1.0)',
  'X-Requested-With': 'XMLHttpRequest',
};

interface PayoutRow {
  postedDate: string;      // e.g. "February 17, 2026 4:40 PM"
  financialResults: string; // e.g. "31/12/2025(YR)"
  details: string;          // e.g. "15%(F) (D)"
  bookClosureRange: string; // e.g. "20/03/2026 - 26/03/2026"
}

function parseDMY(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function parseLongDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\s+\d{1,2}:\d{2}\s*(AM|PM)/i, '').trim();
  const d = new Date(cleaned);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function extractPercent(raw: string): number | null {
  const m = raw.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function extractFinancialYear(raw: string): number | null {
  const m = raw.match(/\/(\d{4})/);
  if (!m) return null;
  return Number(m[1]);
}

function parsePayoutsHtml(symbol: string, html: string): Dividend[] {
  const $ = cheerio.load(html);
  const rows: PayoutRow[] = [];

  $('table tr').each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length < 3) return;
    const postedDate = cells.eq(0).text().trim();
    const financialResults = cells.eq(1).text().trim();
    const details = cells.eq(2).text().trim();
    const bookClosureRange = cells.length > 3 ? cells.eq(3).text().trim() : '';
    if (!postedDate) return;
    rows.push({ postedDate, financialResults, details, bookClosureRange });
  });

  const dividends: Dividend[] = [];

  for (const row of rows) {
    // Only cash dividends (the (D) marker) become Dividend records. Bonuses
    // and rights aren't cash payouts and get exposed via the announcements
    // feed instead.
    if (!/\(D\)/i.test(row.details) && !/\bcash\b/i.test(row.details)) {
      // Fallback: treat pure percent-only rows as cash too (e.g. "15%")
      if (!/^\d+(?:\.\d+)?\s*%/.test(row.details.trim())) continue;
    }

    const amountPercent = extractPercent(row.details);
    if (amountPercent == null) continue;

    // Ex-date = start of book closure range, Payment ≈ posted date.
    const bookRangeMatch = row.bookClosureRange.match(/(\d{2}\/\d{2}\/\d{4}).*?(\d{2}\/\d{2}\/\d{4})/);
    const exDate = parseDMY(bookRangeMatch?.[1]);
    const recordDate = parseDMY(bookRangeMatch?.[2]);
    const paymentDate = parseLongDate(row.postedDate);
    const year = extractFinancialYear(row.financialResults) ?? new Date().getFullYear();

    dividends.push({
      symbol,
      ex_date: exDate ?? paymentDate ?? '',
      record_date: recordDate ?? '',
      payment_date: paymentDate ?? '',
      amount: amountPercent,
      year,
    });
  }

  return dividends;
}

async function fetchPayoutsHtml(symbol: string): Promise<Dividend[]> {
  const upper = symbol.toUpperCase();
  // Portal fetches this fragment from a `payouts` endpoint under the company
  // scope. Try the canonical path; retry on transient failures.
  const path = `/company/payouts/${encodeURIComponent(upper)}`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${DPS_BASE_URL}${path}`, {
        headers: REQUEST_HEADERS,
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`PSX payouts error for ${upper}: ${res.status}`);
      return parsePayoutsHtml(upper, await res.text());
    } catch (err) {
      lastError = err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastError;
}

export function getPayouts(symbol: string): Promise<Dividend[]> {
  return withCache(`psx-portal:payouts:${symbol.toUpperCase()}`, TTL.DIVIDENDS, () => fetchPayoutsHtml(symbol));
}
