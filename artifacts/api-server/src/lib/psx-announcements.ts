// Corporate announcements sourced from PSX's official Data Portal
// (dps.psx.com.pk/announcements).
//
// psxterminal.com's /api/announcements endpoint is unreliable — same approach
// as psx-portal.ts: hit the primary source, parse the HTML table with cheerio,
// map to the existing Announcement shape so the frontend needs no changes.

import * as cheerio from 'cheerio';
import type { Announcement } from './types';
import { withCache, TTL } from './cache';

const DPS_BASE_URL = process.env.PSX_DPS_BASE_URL || 'https://dps.psx.com.pk';

const REQUEST_HEADERS = {
  Accept: 'text/html',
  'User-Agent': 'PSX-Insight/1.0',
  'X-Requested-With': 'XMLHttpRequest',
};

function parseNumberOrNull(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[,%\s]/g, '');
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

// Extract a dividend / bonus / right percent from a title like
// "Cash Dividend @ 25%" or "Bonus Shares 10%".
function extractPercentAfterKeyword(title: string, keyword: RegExp): number | null {
  const match = title.match(new RegExp(`${keyword.source}[^0-9%]{0,40}([0-9]+(?:\\.[0-9]+)?)\\s*%`, 'i'));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

// PSX portal renders the date column with a machine-sortable data-order attribute
// (e.g. "20260215"). Prefer that; fall back to parsing the visible text.
function normaliseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d{8}$/.test(trimmed)) {
    // YYYYMMDD → YYYY-MM-DD
    return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  // dd/MM/yyyy or dd-MM-yyyy
  const m = trimmed.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
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

  // The portal uses a data table under .announcementsTable or similar. Selector
  // is defensive — any <tr> inside a <table> with enough cells will be tried.
  $('table tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 3) return; // header row or unrelated block

    const dateRaw = cells.eq(0).attr('data-order') || cells.eq(0).text();
    const date = normaliseDate(dateRaw);
    if (!date) return;

    const symbol = (cells.eq(1).attr('data-order') || cells.eq(1).text() || '').trim().toUpperCase();
    if (!symbol || symbol.length > 20) return;

    const title = (cells.length >= 4 ? cells.eq(3).text() : cells.eq(2).text()).trim();
    if (!title) return;

    // Attachment link (PDF) — the portal typically renders it in the last cell
    // as an <a href="…"> icon.
    const pdfHref = $(row).find('a[href*="pdf" i], a[href*="download" i]').first().attr('href');
    const pdfUrl = absoluteUrl(pdfHref);

    // Extract common financial actions from the title text.
    const dividend = extractPercentAfterKeyword(title, /(cash\s+dividend|dividend|interim payout|final payout)/);
    const bonus = extractPercentAfterKeyword(title, /bonus/);
    const rightIssue = extractPercentAfterKeyword(title, /right/);

    rows.push({
      id: 0, // upstream id is not exposed on the portal — filled in below
      symbol,
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

  // Assign stable synthetic ids based on ordering, so the frontend can key rows.
  rows.forEach((r, idx) => { r.id = idx + 1; });

  return rows;
}

async function fetchAnnouncementsPage(): Promise<ParsedRow[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${DPS_BASE_URL}/announcements`, {
        headers: REQUEST_HEADERS,
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`PSX announcements page error: ${res.status}`);
      return parseAnnouncementRows(await res.text());
    } catch (err) {
      lastError = err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

/**
 * Cached list of all announcements currently shown on the PSX portal. The
 * portal exposes only a snapshot — no server-side pagination — so we cache
 * the whole list and slice client-side in the /announcements route.
 */
export function fetchAllAnnouncements(): Promise<ParsedRow[]> {
  return withCache('psx-portal:announcements', TTL.ANNOUNCEMENTS, fetchAnnouncementsPage);
}
