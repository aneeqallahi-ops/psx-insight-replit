// Per-symbol company data scraped from PSX's official Data Portal
// (dps.psx.com.pk/company/{SYMBOL}). Replaces psxterminal.com as the primary
// source for the stock detail page: price/change/volume/open/high/low, plus
// fundamentals (P/E, market cap, shares outstanding, free float) and company
// info (name, sector, description). Klines still come from psxterminal.

import * as cheerio from 'cheerio';
import type { CompanyInfo, Fundamentals } from './types';
import { withCache } from './cache';

const DPS_BASE_URL = process.env.PSX_DPS_BASE_URL || 'https://dps.psx.com.pk';

const REQUEST_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,*/*;q=0.9',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': 'Mozilla/5.0 (compatible; PSX-Insight/1.0)',
};

// Cache the parsed snapshot briefly during trading hours. The portal itself is
// ~5-minute delayed so 60s is more than enough.
const COMPANY_TTL_MS = 60_000;

export interface PsxCompanyData {
  symbol: string;
  companyName: string | null;
  sectorPath: string | null;
  price: number | null;
  change: number | null;
  changePercent: number | null; // fraction (0.0158 = +1.58%)
  ldcp: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  peRatio: number | null;
  marketCap: number | null; // rupees (raw table shows thousands)
  sharesOutstanding: number | null;
  freeFloatShares: number | null;
  freeFloatPercent: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  businessDescription: string | null;
  keyPeople: { name: string; position: string }[];
  fiscalYearEnd: string | null;
  website: string | null;
  fetchedAt: number;
}

function parseNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/[,%]/g, '');
  if (!trimmed || trimmed === '-' || trimmed === '--') return null;
  const negative = /^\(.*\)$/.test(trimmed); // accounting negative: (1,234)
  const cleaned = negative ? trimmed.slice(1, -1) : trimmed;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

// Find a value cell by its label text. The portal uses stacked <div> pairs
// (label above value) as well as table rows (<th>label</th><td>value</td>).
// Look for the label anywhere, then take the closest following text with a
// number in it.
function extractByLabel($: cheerio.CheerioAPI, label: string): string | null {
  const wanted = label.toUpperCase();
  let found: string | null = null;

  $('*').each((_, el) => {
    if (found) return false;
    const $el = $(el);
    // Own text without descendants.
    const own = $el.clone().children().remove().end().text().trim().toUpperCase();
    if (own !== wanted) return true;

    // Strategy 1: immediate next sibling with a value.
    const sibling = $el.next().text().trim();
    if (sibling && /\d/.test(sibling)) { found = sibling; return false; }

    // Strategy 2: parent's next-cell text (works for <div><label>X</label></div><div>VALUE</div>).
    const parentSibling = $el.parent().next().text().trim();
    if (parentSibling && /\d/.test(parentSibling)) { found = parentSibling; return false; }

    // Strategy 3: within the same parent, find the first descendant with digits.
    const parentBlock = $el.parent();
    const candidate = parentBlock
      .find('*')
      .filter((_, child) => {
        const t = $(child).text().trim();
        return t !== own && /\d/.test(t) && t.length < 40;
      })
      .first()
      .text()
      .trim();
    if (candidate) { found = candidate; return false; }

    return true;
  });

  return found;
}

// "1.53 — 3.53" or "2.48 - 2.83" style range.
function extractRange(raw: string | null): [number | null, number | null] {
  if (!raw) return [null, null];
  const parts = raw.split(/[—\-–]/).map((s) => s.trim());
  if (parts.length < 2) return [null, null];
  return [parseNumber(parts[0]), parseNumber(parts[1])];
}

function parseKeyPeople($: cheerio.CheerioAPI): { name: string; position: string }[] {
  const people: { name: string; position: string }[] = [];
  // "KEY PEOPLE" section renders as a small table with 2 columns.
  $('h1, h2, h3, h4, strong, b').each((_, el) => {
    const label = $(el).text().trim().toUpperCase();
    if (!label.includes('KEY PEOPLE')) return true;
    const container = $(el).closest('div, section, article');
    container.find('table tr').each((_, tr) => {
      const cells = $(tr).find('td');
      if (cells.length >= 2) {
        const name = cells.eq(0).text().trim();
        const position = cells.eq(1).text().trim();
        if (name && position) people.push({ name, position });
      }
    });
    return false;
  });
  return people;
}

function parseCompanyHtml(symbol: string, html: string): PsxCompanyData {
  const $ = cheerio.load(html);

  const companyName =
    $('h1, h2').filter((_, el) => $(el).text().trim().length > 3).first().text().trim() ||
    null;

  // "INV. BANKS / INV. COS. / SECURITIES COS." usually rendered under the name.
  const sectorPath = $('h1, h2').first().next().text().trim() || null;

  // Quote block values.
  const open = parseNumber(extractByLabel($, 'Open'));
  const high = parseNumber(extractByLabel($, 'High'));
  const low = parseNumber(extractByLabel($, 'Low'));
  const volume = parseNumber(extractByLabel($, 'Volume'));
  const ldcp = parseNumber(extractByLabel($, 'LDCP'));
  const peRatio = parseNumber(extractByLabel($, 'P/E Ratio (TTM)')) ??
                  parseNumber(extractByLabel($, 'P/E Ratio')) ??
                  parseNumber(extractByLabel($, 'P/E'));

  // 52-week and day range come as "min — max".
  const yearRangeRaw = extractByLabel($, '52-Week Range');
  const [yearLow, yearHigh] = extractRange(yearRangeRaw);

  // Current price + change usually shown near the company name, not as
  // labelled fields. Look for "Rs.<price>" and the "(+/-x.xx%)" sibling.
  let price: number | null = null;
  let change: number | null = null;
  let changePercent: number | null = null;
  const priceText = $('body').text().match(/Rs\.?\s*([\d,]+\.?\d*)/);
  if (priceText) price = parseNumber(priceText[1]);
  const changeMatch = $('body').text().match(/([+\-]?\d+\.\d+)\s*\(([+\-]?\d+\.\d+)%\)/);
  if (changeMatch) {
    change = parseNumber(changeMatch[1]);
    changePercent = parseNumber(changeMatch[2]);
    if (changePercent != null) changePercent = changePercent / 100;
  }

  // Equity profile.
  const marketCapThousands = parseNumber(extractByLabel($, "Market Cap (000's)")) ??
                             parseNumber(extractByLabel($, 'Market Cap'));
  const marketCap = marketCapThousands != null ? marketCapThousands * 1000 : null;
  const sharesOutstanding = parseNumber(extractByLabel($, 'Shares'));

  // "Free Float" appears twice on the page — once as a share count, once as %.
  // Extract both values by scanning all cells that follow a "FREE FLOAT" label.
  const freeFloatCandidates: number[] = [];
  $('*').each((_, el) => {
    const own = $(el).clone().children().remove().end().text().trim().toUpperCase();
    if (own !== 'FREE FLOAT') return;
    const sib = $(el).parent().next().text().trim();
    const num = parseNumber(sib);
    if (num != null) freeFloatCandidates.push(num);
  });
  let freeFloatShares: number | null = null;
  let freeFloatPercent: number | null = null;
  for (const n of freeFloatCandidates) {
    if (n > 1_000_000 && freeFloatShares == null) freeFloatShares = n;
    else if (n >= 0 && n <= 100 && freeFloatPercent == null) freeFloatPercent = n;
  }

  // Company profile.
  const businessDescription = $('*').filter((_, el) => {
    return $(el).clone().children().remove().end().text().trim().toUpperCase() === 'BUSINESS DESCRIPTION';
  }).parent().find('p, div').filter((_, el) => $(el).text().trim().length > 60).first().text().trim() || null;

  const website = $('a[href^="http"]').filter((_, el) => {
    const href = $(el).attr('href') || '';
    return !href.includes('psx.com.pk') && !href.includes('capitalstake') && !href.includes('psxterminal');
  }).first().attr('href') || null;

  const fiscalYearEnd = extractByLabel($, 'Fiscal Year End');

  return {
    symbol,
    companyName,
    sectorPath,
    price,
    change,
    changePercent,
    ldcp,
    open,
    high,
    low,
    volume,
    peRatio,
    marketCap,
    sharesOutstanding,
    freeFloatShares,
    freeFloatPercent,
    yearHigh,
    yearLow,
    businessDescription,
    keyPeople: parseKeyPeople($),
    fiscalYearEnd,
    website,
    fetchedAt: Date.now(),
  };
}

async function fetchCompanyPage(symbol: string): Promise<PsxCompanyData> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${DPS_BASE_URL}/company/${encodeURIComponent(symbol)}`, {
        headers: REQUEST_HEADERS,
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`PSX company page error for ${symbol}: ${res.status}`);
      return parseCompanyHtml(symbol, await res.text());
    } catch (err) {
      lastError = err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastError;
}

export function getCompanyData(symbol: string): Promise<PsxCompanyData> {
  const upper = symbol.toUpperCase();
  return withCache(`psx-portal:company:${upper}`, COMPANY_TTL_MS, () => fetchCompanyPage(upper));
}

// Map to the existing Fundamentals shape the frontend already consumes.
export function toFundamentals(data: PsxCompanyData): Fundamentals {
  return {
    symbol: data.symbol,
    sector: data.sectorPath ?? '',
    listedIn: '',
    marketCap: data.marketCap != null ? String(data.marketCap) : '',
    price: data.price ?? 0,
    changePercent: (data.changePercent ?? 0) * 100, // Fundamentals expects percent units
    yearChange: 0,
    peRatio: data.peRatio ?? 0,
    dividendYield: 0,
    freeFloat: data.freeFloatShares != null ? String(data.freeFloatShares) : '',
    volume30Avg: data.volume ?? 0,
    isNonCompliant: false,
    timestamp: new Date(data.fetchedAt).toISOString(),
  };
}

// Map to the existing CompanyInfo shape.
export function toCompanyInfo(data: PsxCompanyData): CompanyInfo {
  return {
    symbol: data.symbol,
    financialStats: {
      marketCap: { raw: data.marketCap != null ? String(data.marketCap) : '', numeric: data.marketCap ?? 0 },
      shares: { raw: data.sharesOutstanding != null ? String(data.sharesOutstanding) : '', numeric: data.sharesOutstanding ?? 0 },
      freeFloat: { raw: data.freeFloatShares != null ? String(data.freeFloatShares) : '', numeric: data.freeFloatShares ?? 0 },
      freeFloatPercent: { raw: data.freeFloatPercent != null ? `${data.freeFloatPercent}%` : '', numeric: data.freeFloatPercent ?? 0 },
    },
    businessDescription: data.businessDescription ?? '',
    keyPeople: data.keyPeople,
  };
}
