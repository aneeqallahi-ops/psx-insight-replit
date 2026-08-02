// Corporate announcements sourced from PSX's official Data Portal
// (dps.psx.com.pk/announcements).
//
// The portal renders the table via a POST to /announcements with form-encoded
// filters (type, symbol, query, count, offset, date_from, date_to, page). We
// mirror that browser request, parse the returned HTML with cheerio, and map
// rows to the Announcement shape so no frontend changes are needed.

import * as cheerio from 'cheerio';
import type { Announcement } from './types';
import { withCache, TTL } from './cache';

const DPS_BASE_URL = process.env.PSX_DPS_BASE_URL || 'https://dps.psx.com.pk';

const REQUEST_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,*/*;q=0.9',
  'Accept-Language': 'en-US,en;q=0.9',
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  Origin: DPS_BASE_URL,
  Referer: `${DPS_BASE_URL}/announcements`,
  'User-Agent': 'Mozilla/5.0 (compatible; PSX-Insight/1.0)',
  'X-Requested-With': 'XMLHttpRequest',
};

function extractPercentAfterKeyword(title: string, keyword: RegExp): number | null {
  const match = title.match(new RegExp(`${keyword.source}[^0-9%]{0,40}([0-9]+(?:\\.[0-9]+)?)\\s*%`, 'i'));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

// Symbols on PSX are 2-8 uppercase letters/digits. Extract from a title like
// "OGDC: Board Meeting Notice" or "Cash Dividend – HBL".
function extractSymbolFromTitle(title: string): string | null {
  const match =
    title.match(/^([A-Z][A-Z0-9]{1,7})\s*[:\-–—]/) ||
    title.match(/\(([A-Z][A-Z0-9]{1,7})\)/) ||
    title.match(/\b([A-Z][A-Z0-9]{2,7})\b/);
  return match ? match[1] : null;
}

function normaliseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d{8}$/.test(trimmed)) {
    return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const dmy = trimmed.match(/^(\d{1,2})[\/\-\s](\w{3,}|\d{1,2})[\/\-\s,]\s*(\d{4})/);
  if (dmy) {
    const parsed = new Date(`${dmy[2]} ${dmy[1]}, ${dmy[3]}`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

function absoluteUrl(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    return new URL(href, DPS_BASE_URL).toString();
  } catch {
    return null;
  }
}

interface ParsedRow extends Partial<Announcement> {
  id: number;
  symbol: string;
  title: string;
  date: string;
  announcement_type: string;
}

function parseAnnouncementRows(html: string): ParsedRow[] {
  const $ = cheerio.load(html);
  const rows: ParsedRow[] = [];

  $('table tr').each((idx, row) => {
    const cells = $(row).find('td');
    if (cells.length < 3) return;

    // Try each cell for a parseable date — the portal's column layout
    // varies by announcement type, so we don't hardcode positions.
    let date: string | null = null;
    let dateIdx = -1;
    for (let i = 0; i < Math.min(cells.length, 3); i++) {
      const raw = cells.eq(i).attr('data-order') || cells.eq(i).text();
      const parsed = normaliseDate(raw);
      if (parsed) { date = parsed; dateIdx = i; break; }
    }
    if (!date) return;

    // Symbol column (if present) usually appears immediately after date.
    // For "PSX Notices" style rows there's no symbol column — we extract it
    // from the title text as a fallback.
    let symbol = '';
    for (let i = dateIdx + 1; i < cells.length; i++) {
      const raw = (cells.eq(i).attr('data-order') || cells.eq(i).text() || '').trim().toUpperCase();
      if (/^[A-Z][A-Z0-9]{1,7}$/.test(raw)) { symbol = raw; break; }
    }

    // Title cell = the widest text cell that isn't a date/time/symbol/PDF link.
    let title = '';
    let bestLen = 0;
    cells.each((i, cell) => {
      const text = $(cell).text().trim();
      if (text.length > bestLen && !/^\d/.test(text) && !/^(pdf|download|view)$/i.test(text)) {
        bestLen = text.length;
        title = text;
      }
      return true;
    });
    if (!title) return;

    if (!symbol) {
      symbol = extractSymbolFromTitle(title) ?? '';
    }

    const pdfHref = $(row).find('a[href*="pdf" i], a[href*="download" i], a[href$=".pdf" i]').first().attr('href');
    const pdfUrl = absoluteUrl(pdfHref);

    const dividend = extractPercentAfterKeyword(title, /(cash\s+dividend|dividend|interim payout|final payout)/);
    const bonus = extractPercentAfterKeyword(title, /bonus/);
    const rightIssue = extractPercentAfterKeyword(title, /right/);

    rows.push({
      id: idx + 1,
      symbol: symbol || 'PSX',
      date,
      announcement_type: title,
      title,
      created_at: date,
      updated_at: date,
      pdf_id: pdfUrl,
      image_link: null,
      dividend,
      bonus,
      right_issue: rightIssue,
    });
  });

  return rows;
}

interface PsxAnnouncementQuery {
  type?: string;
  symbol?: string;
  offset?: number;
  count?: number;
  dateFrom?: string;
  dateTo?: string;
}

async function fetchAnnouncementsPage(q: PsxAnnouncementQuery): Promise<ParsedRow[]> {
  const body = new URLSearchParams();
  body.set('type', q.type ?? 'E');
  body.set('symbol', q.symbol ?? '');
  body.set('query', '');
  body.set('count', String(q.count ?? 50));
  body.set('offset', String(q.offset ?? 0));
  body.set('date_from', q.dateFrom ?? '');
  body.set('date_to', q.dateTo ?? '');
  body.set('page', 'annc');

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${DPS_BASE_URL}/announcements`, {
        method: 'POST',
        headers: REQUEST_HEADERS,
        body: body.toString(),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`PSX announcements POST error: ${res.status}`);
      return parseAnnouncementRows(await res.text());
    } catch (err) {
      lastError = err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

/**
 * Cached list of the latest 50 announcements from the PSX portal. Uses the
 * portal's default "type=E" (corporate events) — dividends, bonuses, board
 * meetings, book closures, corporate briefings.
 */
export function fetchAllAnnouncements(): Promise<ParsedRow[]> {
  return withCache('psx-portal:announcements:E', TTL.ANNOUNCEMENTS, () =>
    fetchAnnouncementsPage({ type: 'E', count: 50, offset: 0 }),
  );
}
