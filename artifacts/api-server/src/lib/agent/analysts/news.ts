import { getStoredNews } from '../../news-scraper';
import { analyze, extractJson } from '../llm';
import type { AnalystReport } from './technical';

const SYSTEM = `You are a financial news analyst covering the Pakistan Stock Exchange (PSX).
You read recent news headlines and short bodies and assess whether they are net-positive, net-negative, or mixed for a specific symbol.
Always answer in JSON with exact keys: {"summary": string, "signals": string[], "confidence": number 0-100}.
Keep summary under 4 sentences. Each signal is one short bullet referencing a concrete article theme.
If the only news is generic market commentary, say so explicitly.`;

const MAX_ARTICLES_PER_SYMBOL = 10;
const MAX_BODY_CHARS = 800;

export async function newsAnalyst(symbol: string): Promise<AnalystReport> {
  const all = await getStoredNews();
  const tagged = all.filter((a) => a.symbols.includes(symbol)).slice(0, MAX_ARTICLES_PER_SYMBOL);

  // If no symbol-tagged news, fall back to generic recent news for context.
  const articles = tagged.length > 0 ? tagged : all.slice(0, 5);
  const symbolSpecific = tagged.length > 0;

  if (articles.length === 0) {
    return {
      summary: 'No recent news available in the cache.',
      signals: ['News cache is empty'],
      confidence: 5,
      citations: [],
    };
  }

  const articleSection = articles
    .map((a, i) => {
      const body = (a.fullText || a.summary || '').slice(0, MAX_BODY_CHARS).replace(/\s+/g, ' ').trim();
      return `[${i + 1}] ${a.headline}
Source: ${a.source ?? 'news'} | Published: ${a.publishedAt}
${body}`;
    })
    .join('\n\n');

  const context = symbolSpecific
    ? `${articles.length} article(s) tagged with ${symbol}`
    : `No articles tagged with ${symbol}; showing ${articles.length} general market headlines for context`;

  const prompt = `Symbol: ${symbol}
Context: ${context}

ARTICLES:
${articleSection}

Assess news sentiment for ${symbol}. If only general market context is available, your confidence should be low and you should say so. Reference articles by their bracket number when citing themes.`;

  const text = await analyze(prompt, { system: SYSTEM });
  const parsed = extractJson<{ summary: string; signals: string[]; confidence: number }>(text);

  return {
    summary: parsed.summary,
    signals: Array.isArray(parsed.signals) ? parsed.signals.slice(0, 6) : [],
    confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
    citations: articles.map((a) => ({
      kind: 'news' as const,
      title: a.headline,
      source: a.source ?? 'News',
      url: a.url,
      asOf: a.publishedAt,
    })),
    raw: { articleCount: articles.length, symbolSpecific },
  };
}
