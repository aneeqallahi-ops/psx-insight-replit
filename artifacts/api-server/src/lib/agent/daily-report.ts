import { PSXApi } from '../psx-api';
import { getStoredNews } from '../news-scraper';
import type { BreadthStats, MarketStats, SectorData } from '../types';
import { analyze, extractJson } from './llm';
import type { Citation } from './types';

export interface DailyMarketReport {
  asOf: string;
  headline: string;
  summary: string;
  topPicks: { symbol: string; reason: string }[];
  sectorsInFavor: { sector: string; reason: string }[];
  sectorsOutOfFavor: { sector: string; reason: string }[];
  breadthSignal: string;
  macroNewsSummary: string;
  citations: Citation[];
  generatedAt: string;
}

const SYSTEM = `You are the head of research at a Pakistan brokerage writing the end-of-day market briefing.
Output strict JSON only with this exact shape:
{
  "headline": string (one-liner, max 18 words),
  "summary": string (3-4 sentences overview of the day's session),
  "topPicks": [{"symbol": string, "reason": string (1 sentence)}] (3-5 items),
  "sectorsInFavor": [{"sector": string, "reason": string}] (1-3 items),
  "sectorsOutOfFavor": [{"sector": string, "reason": string}] (1-3 items),
  "breadthSignal": string (1-2 sentences on advance/decline + volume),
  "macroNewsSummary": string (2-3 sentences distilling the news cache)
}

Guidelines:
- Be specific. Reference actual symbols, sector names, and percent moves from the data.
- Do not invent data not present in the inputs.
- Use PKR for currency where relevant.`;

function isMarketStats(d: unknown): d is MarketStats {
  return typeof d === 'object' && d !== null && 'totalVolume' in d && 'topGainers' in d;
}

function isSectorMap(d: unknown): d is Record<string, SectorData> {
  return typeof d === 'object' && d !== null && !('totalVolume' in d) && !('advances' in d);
}

function isBreadth(d: unknown): d is BreadthStats {
  return typeof d === 'object' && d !== null && 'advances' in d && 'declines' in d;
}

export async function generateDailyReport(): Promise<DailyMarketReport> {
  const [statsR, sectorsR, breadthR] = await Promise.allSettled([
    PSXApi.getStats('REG'),
    PSXApi.getStats('sectors'),
    PSXApi.getStats('breadth'),
  ]);

  const stats = statsR.status === 'fulfilled' && isMarketStats(statsR.value) ? statsR.value : null;
  const sectors = sectorsR.status === 'fulfilled' && isSectorMap(sectorsR.value) ? sectorsR.value : null;
  const breadth = breadthR.status === 'fulfilled' && isBreadth(breadthR.value) ? breadthR.value : null;
  const news = (await getStoredNews()).slice(0, 15);

  const topGainersStr = stats?.topGainers
    ?.slice(0, 5)
    .map((m) => `${m.symbol} ${m.changePercent.toFixed(2)}% (PKR ${m.price.toFixed(2)})`)
    .join(', ') || 'n/a';
  const topLosersStr = stats?.topLosers
    ?.slice(0, 5)
    .map((m) => `${m.symbol} ${m.changePercent.toFixed(2)}% (PKR ${m.price.toFixed(2)})`)
    .join(', ') || 'n/a';

  const sectorEntries = sectors
    ? Object.entries(sectors)
        .map(([name, d]) => ({
          name,
          avgChangePct: d.avgChangePercent,
          totalVolume: d.totalVolume,
          gainers: d.gainers,
          losers: d.losers,
        }))
        .sort((a, b) => b.avgChangePct - a.avgChangePct)
    : [];

  const topSectors = sectorEntries.slice(0, 5)
    .map((s) => `${s.name}: avg ${s.avgChangePct.toFixed(2)}%, vol ${s.totalVolume.toLocaleString()} (${s.gainers} up / ${s.losers} down)`)
    .join('\n');
  const bottomSectors = sectorEntries.slice(-5).reverse()
    .map((s) => `${s.name}: avg ${s.avgChangePct.toFixed(2)}%, vol ${s.totalVolume.toLocaleString()} (${s.gainers} up / ${s.losers} down)`)
    .join('\n');

  const newsSection = news
    .map((a) => `- [${a.source ?? 'news'}] ${a.headline}: ${(a.summary || '').slice(0, 240).replace(/\s+/g, ' ')}`)
    .join('\n') || 'No recent news in cache';

  const prompt = `Date: ${new Date().toISOString().slice(0, 10)} (Asia/Karachi session)

MARKET STATS (REG):
Total volume: ${stats?.totalVolume?.toLocaleString() ?? 'n/a'}
Total value: ${stats?.totalValue?.toLocaleString() ?? 'n/a'}
Symbols traded: ${stats?.symbolCount ?? 'n/a'}
Gainers/Losers/Unchanged: ${stats?.gainers ?? '?'} / ${stats?.losers ?? '?'} / ${stats?.unchanged ?? '?'}

TOP GAINERS: ${topGainersStr}
TOP LOSERS: ${topLosersStr}

BREADTH:
Advances: ${breadth?.advances ?? 'n/a'} | Declines: ${breadth?.declines ?? 'n/a'} | Unchanged: ${breadth?.unchanged ?? 'n/a'}
A/D ratio: ${breadth?.advanceDeclineRatio?.toFixed(2) ?? 'n/a'} | A/D %: ${breadth?.advanceDeclinePercent?.toFixed(2) ?? 'n/a'}
Up volume: ${breadth?.upVolume?.toLocaleString() ?? 'n/a'} | Down volume: ${breadth?.downVolume?.toLocaleString() ?? 'n/a'}

TOP SECTORS BY AVG CHANGE %:
${topSectors || 'n/a'}

WORST SECTORS BY AVG CHANGE %:
${bottomSectors || 'n/a'}

RECENT NEWS (cached):
${newsSection}

Produce the JSON daily market briefing now.`;

  const text = await analyze(prompt, { system: SYSTEM, maxTokens: 4096 });
  const parsed = extractJson<{
    headline: string;
    summary: string;
    topPicks: { symbol: string; reason: string }[];
    sectorsInFavor: { sector: string; reason: string }[];
    sectorsOutOfFavor: { sector: string; reason: string }[];
    breadthSignal: string;
    macroNewsSummary: string;
  }>(text);

  return {
    asOf: new Date().toISOString().slice(0, 10),
    headline: parsed.headline ?? 'PSX daily market report',
    summary: parsed.summary ?? '',
    topPicks: Array.isArray(parsed.topPicks) ? parsed.topPicks.slice(0, 5) : [],
    sectorsInFavor: Array.isArray(parsed.sectorsInFavor) ? parsed.sectorsInFavor.slice(0, 3) : [],
    sectorsOutOfFavor: Array.isArray(parsed.sectorsOutOfFavor) ? parsed.sectorsOutOfFavor.slice(0, 3) : [],
    breadthSignal: parsed.breadthSignal ?? '',
    macroNewsSummary: parsed.macroNewsSummary ?? '',
    citations: ([
      { kind: 'market', title: 'PSX market stats (REG board)', source: 'psxterminal.com' },
      sectors ? { kind: 'market', title: 'PSX sector stats', source: 'psxterminal.com' } : null,
      breadth ? { kind: 'market', title: 'PSX breadth (advances/declines)', source: 'psxterminal.com' } : null,
      ...news.slice(0, 5).map((a) => ({
        kind: 'news' as const,
        title: a.headline,
        source: a.source ?? 'News',
        url: a.url,
        asOf: a.publishedAt,
      })),
    ].filter(Boolean) as Citation[]),
    generatedAt: new Date().toISOString(),
  };
}
