import * as cheerio from 'cheerio';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

const METTIS_BASE_URL = 'https://mettisglobal.news';
const NEWS_STORE_PATH = path.join('/tmp', 'psx-insight-news', 'articles.json');
const SCRAPE_INTERVAL_MS = 30 * 60 * 1000;
const ARTICLE_FETCH_CONCURRENCY = 5;
const LISTING_FETCH_CONCURRENCY = 4;
const MAX_METTIS_ARTICLES = 80;
const MAX_ARTICLE_AGE_MS = 14 * 24 * 60 * 60 * 1000;

// Mettis homepage exposes ~15 articles. Category pages each expose another
// 5-15. Crawling these in parallel lets us surface a much richer feed.
// Category pages are listed FIRST so they win on URL dedup and articles get
// their proper category (vs the generic "Latest" homepage bucket).
const METTIS_LISTING_PAGES: { path: string; category: string }[] = [
  { path: '/Equity', category: 'Equity' },
  { path: '/Economy', category: 'Economy' },
  { path: '/Forex', category: 'Forex' },
  { path: '/Commodities', category: 'Commodities' },
  { path: '/Earnings', category: 'Earnings' },
  { path: '/CentralBank', category: 'Central Bank' },
  { path: '/CompanyAnalysis', category: 'Company Analysis' },
  { path: '/CorporateRoundup', category: 'Corporate' },
  { path: '/', category: 'Latest' },
];

export interface NewsArticle {
  headline: string;
  url: string;
  category: string;
  publishedAt: string;
  summary: string;
  fullText: string;
  symbols: string[];
  source?: string;
}

interface CandidateArticle {
  headline: string;
  url: string;
  category: string;
  publishedAt?: string;
  summary?: string;
  fullText?: string;
  symbols?: string[];
  source?: string;
}

interface NewsStore {
  lastScrapedAt: string | null;
  articles: NewsArticle[];
}

declare global {
  // eslint-disable-next-line no-var
  var __psxNewsScheduler: NodeJS.Timeout | undefined;
  // eslint-disable-next-line no-var
  var __psxNewsScrapePromise: Promise<NewsArticle[]> | undefined;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function absoluteUrl(href: string, baseUrl: string) {
  return new URL(href, baseUrl).toString();
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

function parseMettisPublishedAt(value: string) {
  const match = value.match(/[A-Z][a-z]+ \d{1,2}, \d{4} at \d{1,2}:\d{2} [AP]M GMT[+-]\d{2}:\d{2}/);
  if (!match) return new Date().toISOString();
  const parsed = new Date(match[0].replace(' at ', ' '));
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function inferSource(url: string) {
  if (url.includes('mettisglobal.news')) return 'Mettis Global';
  if (url.includes('dps.psx.com.pk') || url.includes('psx.com.pk')) return 'Pakistan Stock Exchange';
  if (url.includes('sbp.org.pk')) return 'State Bank of Pakistan';
  return undefined;
}

function extractSymbols(text: string) {
  const ignore = new Set([
    'AM', 'BOE', 'CEO', 'CFO', 'CPEC', 'ECB', 'EPS', 'GDP', 'GMT', 'IPO',
    'KSE', 'MLN', 'MPC', 'OMC', 'PKR', 'PM', 'PR', 'PSX', 'SECP', 'SBP', 'USD',
    'THE', 'FOR', 'ARE', 'AND', 'NOT', 'INC', 'LTD', 'PVT', 'PLC', 'CORP',
  ]);
  const matches = text.match(/\b[A-Z]{2,6}\b/g) ?? [];
  return [...new Set(matches.filter((s) => !ignore.has(s)))].sort();
}

function getMettisListingArticles(html: string, defaultCategory: string) {
  const $ = cheerio.load(html);
  const articles = new Map<string, CandidateArticle>();
  const selectors = [
    'h2.HeadlineStyle a[href]',
    '.LimitedHeading a[href]',
    `a[href^="${METTIS_BASE_URL}/"]`,
    'a[href^="/"]',
  ];

  for (const selector of selectors) {
    $(selector).each((_, element) => {
      const href = $(element).attr('href');
      const headline = normalizeText($(element).text());
      if (!href || headline.length < 18) return;
      const url = absoluteUrl(href, METTIS_BASE_URL);
      const isArticleUrl = /^https:\/\/mettisglobal\.news\/[^/?#]+-\d{4,}$/.test(url);
      if (!isArticleUrl || articles.has(url)) return;
      // Use the explicit defaultCategory taken from the listing page we're
      // crawling (e.g. "Equity"). The old section-based heuristic was unreliable
      // and often returned adjacent article headlines as the "category".
      articles.set(url, {
        headline,
        url,
        category: defaultCategory,
        source: 'Mettis Global',
      });
    });
  }

  return [...articles.values()];
}

async function fetchMettisListingPage(
  page: { path: string; category: string },
): Promise<CandidateArticle[]> {
  try {
    const res = await fetch(`${METTIS_BASE_URL}${page.path}`, {
      headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (compatible; PSX-Insight/1.0)' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    return getMettisListingArticles(await res.text(), page.category);
  } catch {
    return [];
  }
}

function extractMettisArticleText($: cheerio.CheerioAPI) {
  const paragraphs = $('.postNews .MsoNormal, .postNews p')
    .map((_, el) => normalizeText($(el).text()))
    .get()
    .filter((t) => t.length > 30)
    .filter((t) => !/^MG News \|/.test(t))
    .filter((t) => !/^(Listen|Resize|Small|Medium|Large|Join our Whatsapp channel)$/i.test(t));

  if (paragraphs.length) return paragraphs.join('\n\n');
  const fallback = normalizeText($('.postNews').first().text());
  return fallback
    .replace(/^.*?GMT[+-]\d{2}:\d{2}/, '')
    .replace(/Listen Resize Small Medium Large.*?1x 2x/i, '')
    .trim();
}

async function fetchMettisArticleDetails(article: CandidateArticle): Promise<NewsArticle | null> {
  try {
    const res = await fetch(article.url, {
      headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (compatible; PSX-Insight/1.0)' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    const headline = normalizeText($('h1').first().text()) || article.headline;
    const metaSummary =
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      '';
    const fullText = extractMettisArticleText($);
    const summary = normalizeText(metaSummary) || fullText.slice(0, 240);
    const publishedAt = parseMettisPublishedAt(normalizeText($('.postNews .Listnewscategroy').first().text()));
    const symbols = extractSymbols(`${headline} ${summary} ${fullText}`);
    return { headline, url: article.url, category: article.category, publishedAt, summary, fullText, symbols, source: article.source };
  } catch {
    return null;
  }
}

async function readStore(): Promise<NewsStore> {
  try {
    const raw = await readFile(NEWS_STORE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as NewsStore;
    return {
      lastScrapedAt: parsed.lastScrapedAt ?? null,
      articles: Array.isArray(parsed.articles)
        ? parsed.articles.map((a) => ({ ...a, source: a.source ?? inferSource(a.url) }))
        : [],
    };
  } catch {
    return { lastScrapedAt: null, articles: [] };
  }
}

async function writeStore(store: NewsStore) {
  await mkdir(path.dirname(NEWS_STORE_PATH), { recursive: true });
  await writeFile(NEWS_STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
}

function pruneArticles(articles: NewsArticle[]) {
  const cutoff = Date.now() - MAX_ARTICLE_AGE_MS;
  const deduped = new Map<string, NewsArticle>();
  for (const article of articles.filter((a) => new Date(a.publishedAt).getTime() >= cutoff)) {
    const key = [
      article.source ?? inferSource(article.url) ?? '',
      article.publishedAt,
      article.headline,
    ].join('|');
    const existing = deduped.get(key);
    if (!existing || article.url.length > existing.url.length) {
      deduped.set(key, article);
    }
  }
  return [...deduped.values()].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
}

export async function scrapeMettisNews() {
  if (globalThis.__psxNewsScrapePromise) return globalThis.__psxNewsScrapePromise;

  globalThis.__psxNewsScrapePromise = (async () => {
    const store = await readStore();
    const existingByUrl = new Map(store.articles.map((a) => [a.url, a]));

    // Crawl the homepage + several category pages in parallel.
    const listings = await mapWithConcurrency(
      METTIS_LISTING_PAGES,
      LISTING_FETCH_CONCURRENCY,
      (page) => fetchMettisListingPage(page),
    );

    // Dedupe candidates by URL across all listing pages.
    const candidatesByUrl = new Map<string, CandidateArticle>();
    for (const list of listings) {
      for (const candidate of list) {
        if (!candidatesByUrl.has(candidate.url)) {
          candidatesByUrl.set(candidate.url, candidate);
        }
      }
    }

    const newCandidates = [...candidatesByUrl.values()]
      .filter((c) => !existingByUrl.has(c.url))
      .slice(0, MAX_METTIS_ARTICLES);

    const fetched = await mapWithConcurrency(
      newCandidates,
      ARTICLE_FETCH_CONCURRENCY,
      (c) => fetchMettisArticleDetails(c),
    );

    const nextArticles = [...store.articles];
    for (const detailed of fetched) {
      if (!detailed) continue;
      nextArticles.push(detailed);
      existingByUrl.set(detailed.url, detailed);
    }

    const articles = pruneArticles(nextArticles);
    await writeStore({ lastScrapedAt: new Date().toISOString(), articles });
    return articles;
  })().finally(() => { globalThis.__psxNewsScrapePromise = undefined; });

  return globalThis.__psxNewsScrapePromise;
}

export async function getStoredNews() {
  const store = await readStore();
  return pruneArticles(store.articles);
}

export async function getNewsWithRefresh() {
  const store = await readStore();
  const lastScrapedAt = store.lastScrapedAt ? new Date(store.lastScrapedAt).getTime() : 0;
  const isStale = Date.now() - lastScrapedAt > SCRAPE_INTERVAL_MS;

  // Block on scrape only if we have nothing to show.
  if (store.articles.length === 0) {
    return scrapeMettisNews();
  }

  // Otherwise return cached immediately and refresh in background if stale.
  if (isStale) {
    scrapeMettisNews().catch((err) => {
      console.error('Background news scrape failed:', err);
    });
  }
  return pruneArticles(store.articles);
}

export function ensureNewsScheduler() {
  if (globalThis.__psxNewsScheduler) return;
  globalThis.__psxNewsScheduler = setInterval(() => {
    scrapeMettisNews().catch(console.error);
  }, SCRAPE_INTERVAL_MS);
  scrapeMettisNews().catch(console.error);
}
