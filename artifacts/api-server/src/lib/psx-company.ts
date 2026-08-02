// Per-symbol company data scraped from PSX's official Data Portal
// (dps.psx.com.pk/company/{SYMBOL}). Replaces psxterminal.com as the primary
// source for the stock detail page: price/change/volume/open/high/low, plus
// fundamentals (P/E, market cap, shares outstanding, free float) and company
// info (name, sector, description). Klines still come from psxterminal.

import * as cheerio from 'cheerio';
import type { CompanyInfo, Fundamentals } from './types';
import { withCache } from './cache';
import { portalFetch } from './psx-http';

const DPS_BASE_URL = process.env.PSX_DPS_BASE_URL || 'https://dps.psx.com.pk';

const REQUEST_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,*/*;q=0.9',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': 'Mozilla/5.0 (compatible; PSX-Insight/1.0)',
};

// Cache the parsed snapshot briefly during trading hours. The portal itself is
// ~5-minute delayed so 60s is more than enough.
const COMPANY_TTL_MS = 60_000;

export interface PsxFinancialRow {
  year: number;
  markupEarned: number | null;
  totalIncome: number | null;
  profitAfterTax: number | null;
  eps: number | null;
}

export interface PsxRatioRow {
  year: number;
  netProfitMargin: number | null;
  epsGrowth: number | null;
  peg: number | null;
}

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
  fiscalYearEnd: string | null;
  website: string | null;
  financials: PsxFinancialRow[];
  ratios: PsxRatioRow[];
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
function normaliseLabel(text: string): string {
  return text.toUpperCase().replace(/\s+/g, ' ').replace(/[’‘'`]/g, "'").trim();
}

function extractByLabel($: cheerio.CheerioAPI, label: string): string | null {
  const wanted = normaliseLabel(label);
  let found: string | null = null;

  $('*').each((_, el) => {
    if (found) return false;
    const $el = $(el);
    // Own text without descendants.
    const own = normaliseLabel($el.clone().children().remove().end().text());
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

// Find a table whose header contains a specific label ("Profit after Taxation",
// "Net Profit Margin", etc.) and return its rows as label → [values by column].
// The first row of PSX's financial tables is year headers ("2025 2024 2023 2022").
function findLabeledTable($: cheerio.CheerioAPI, rowLabel: string): { years: number[]; rows: Map<string, (number | null)[]> } | null {
  let match: { years: number[]; rows: Map<string, (number | null)[]> } | null = null;
  $('table').each((_, table) => {
    if (match) return false;
    const $table = $(table);
    const bodyText = $table.text();
    if (!bodyText.toUpperCase().includes(rowLabel.toUpperCase())) return true;

    // Extract year headers (numeric 4-digit values in the header row).
    const years: number[] = [];
    $table.find('tr').first().find('th, td').each((_, cell) => {
      const val = $(cell).text().trim();
      if (/^\d{4}$/.test(val)) years.push(Number(val));
    });
    if (years.length === 0) return true;

    const rows = new Map<string, (number | null)[]>();
    $table.find('tr').each((_, tr) => {
      const cells = $(tr).find('td, th');
      if (cells.length < 2) return;
      const label = cells.eq(0).text().trim();
      if (!label) return;
      const values: (number | null)[] = [];
      for (let i = 1; i < cells.length && i - 1 < years.length; i++) {
        values.push(parseNumber(cells.eq(i).text()));
      }
      if (values.some((v) => v !== null)) rows.set(label, values);
    });
    match = { years, rows };
    return false;
  });
  return match;
}

function findRow(rows: Map<string, (number | null)[]>, pattern: RegExp): (number | null)[] | null {
  for (const [label, values] of rows) {
    if (pattern.test(label)) return values;
  }
  return null;
}

function parseFinancials($: cheerio.CheerioAPI): PsxFinancialRow[] {
  const table = findLabeledTable($, 'Profit after Taxation');
  if (!table) return [];
  const markup = findRow(table.rows, /mark[-\s]?up\s+earned|revenue|net\s+sales|total\s+revenue/i);
  const totalIncome = findRow(table.rows, /total\s+income/i);
  const profit = findRow(table.rows, /profit\s+after\s+tax/i);
  const eps = findRow(table.rows, /^EPS$/i);
  return table.years.map((year, i) => ({
    year,
    markupEarned: markup?.[i] ?? null,
    totalIncome: totalIncome?.[i] ?? null,
    profitAfterTax: profit?.[i] ?? null,
    eps: eps?.[i] ?? null,
  }));
}

function parseRatios($: cheerio.CheerioAPI): PsxRatioRow[] {
  const table = findLabeledTable($, 'Net Profit Margin');
  if (!table) return [];
  const npm = findRow(table.rows, /net\s+profit\s+margin/i);
  const epsGrowth = findRow(table.rows, /EPS\s+growth/i);
  const peg = findRow(table.rows, /^PEG$/i);
  return table.years.map((year, i) => ({
    year,
    netProfitMargin: npm?.[i] ?? null,
    epsGrowth: epsGrowth?.[i] ?? null,
    peg: peg?.[i] ?? null,
  }));
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
  // labelled fields. Look for "Rs.<price>" and then the change/% pattern
  // that follows it (within a short window). This avoids matching the
  // header ticker's "X.XX (Y.YY%)" values from other symbols on the page.
  let price: number | null = null;
  let change: number | null = null;
  let changePercent: number | null = null;
  const bodyText = $('body').text();
  const priceMatch = bodyText.match(/Rs\.?\s*([\d,]+\.?\d*)/);
  if (priceMatch) {
    price = parseNumber(priceMatch[1]);
    // Search for the change% pattern in the ~300 chars after the price.
    const start = priceMatch.index ?? 0;
    const nearby = bodyText.substring(start, start + 300);
    const changeMatch = nearby.match(/([+\-−]?\d+(?:\.\d+)?)\s*\(([+\-−]?\d+(?:\.\d+)?)\s*%\)/);
    if (changeMatch) {
      const sign = changeMatch[2].startsWith('-') || changeMatch[2].startsWith('−') ? -1 : 1;
      const pctRaw = Number(changeMatch[2].replace(/[−\-+]/g, ''));
      changePercent = Number.isFinite(pctRaw) ? (sign * pctRaw) / 100 : null;
    }
    // Compute change from price × changePercent (more reliable than the
    // scraped text, which we've seen pick up index-ticker numbers).
    if (price != null && changePercent != null) {
      change = +(price * changePercent).toFixed(2);
    }
  }

  // Equity profile.
  const marketCapThousands = parseNumber(extractByLabel($, "Market Cap (000's)")) ??
                             parseNumber(extractByLabel($, 'Market Cap'));
  const marketCap = marketCapThousands != null ? marketCapThousands * 1000 : null;
  const sharesOutstanding = parseNumber(extractByLabel($, 'Shares'));

  // "Free Float" appears twice on the page — once as a share count, once as %.
  // Values that are plausibly a percent (≤100 and contain no comma) → %.
  // Values with commas (thousands separator) or >100 → share count.
  const freeFloatCandidates: string[] = [];
  $('*').each((_, el) => {
    const own = normaliseLabel($(el).clone().children().remove().end().text());
    if (own !== 'FREE FLOAT') return;
    // Look at siblings, parent siblings, and nested cells for the value.
    const $el = $(el);
    const candidates = [
      $el.next().text().trim(),
      $el.parent().next().text().trim(),
      $el.parent().find('*').filter((_, x) => /\d/.test($(x).text().trim()) && $(x).text().trim().length < 40).first().text().trim(),
    ].filter((v) => v && /\d/.test(v));
    for (const c of candidates) {
      if (!freeFloatCandidates.includes(c)) freeFloatCandidates.push(c);
    }
  });

  let freeFloatShares: number | null = null;
  let freeFloatPercent: number | null = null;
  for (const raw of freeFloatCandidates) {
    const parsed = parseNumber(raw);
    if (parsed == null) continue;
    if (/,/.test(raw) || parsed > 100) {
      if (freeFloatShares == null) freeFloatShares = parsed;
    } else if (parsed >= 0 && parsed <= 100) {
      if (freeFloatPercent == null) freeFloatPercent = parsed;
    }
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
    fiscalYearEnd,
    website,
    financials: parseFinancials($),
    ratios: parseRatios($),
    fetchedAt: Date.now(),
  };
}

async function fetchCompanyPage(symbol: string): Promise<PsxCompanyData> {
  const res = await portalFetch(`${DPS_BASE_URL}/company/${encodeURIComponent(symbol)}`, {
    headers: REQUEST_HEADERS,
    timeoutMs: 20_000,
  });
  if (!res.ok) throw new Error(`PSX company page error for ${symbol}: ${res.status}`);
  return parseCompanyHtml(symbol, await res.text());
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

function formatWithCommas(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
}

// Map to the existing CompanyInfo shape.
export function toCompanyInfo(data: PsxCompanyData): CompanyInfo {
  return {
    symbol: data.symbol,
    financialStats: {
      marketCap: { raw: formatWithCommas(data.marketCap), numeric: data.marketCap ?? 0 },
      shares: { raw: formatWithCommas(data.sharesOutstanding), numeric: data.sharesOutstanding ?? 0 },
      freeFloat: { raw: formatWithCommas(data.freeFloatShares), numeric: data.freeFloatShares ?? 0 },
      freeFloatPercent: { raw: data.freeFloatPercent != null ? `${data.freeFloatPercent}%` : '', numeric: data.freeFloatPercent ?? 0 },
    },
    businessDescription: data.businessDescription ?? '',
    keyPeople: [],
  };
}
