import { analyzeStream, extractJson } from '../llm';
import type { Citation } from '../types';
import type { AnalystReport } from './technical';

export type Verdict = 'Buy' | 'Hold' | 'Sell';

export interface SynthesisReport {
  verdict: Verdict;
  confidence: number;
  headline: string;
  rationale: {
    technicals: string;
    fundamentals: string;
    news: string;
  };
  citations: Citation[];
  generatedAt: string;
}

const SYSTEM = `You are the senior PM at a Pakistan equity desk. You receive three analyst notes on a stock — a technical read, a fundamental read, and a news read — each with their own confidence. You weigh them and issue ONE verdict: "Buy", "Hold", or "Sell".

Output strict JSON only, with this exact shape:
{
  "verdict": "Buy" | "Hold" | "Sell",
  "confidence": number 0-100,
  "headline": string (max 18 words; the one-liner you'd put on a deck slide),
  "rationale": {
    "technicals": string (2-3 sentences),
    "fundamentals": string (2-3 sentences),
    "news": string (2-3 sentences)
  }
}

Guidelines:
- Be decisive but honest. If signals genuinely conflict, "Hold" with explanation is better than a forced "Buy".
- Reference specific data points from the analyst notes, not generic platitudes.
- Confidence reflects how much you trust the verdict given input quality.`;

export async function synthesize(
  symbol: string,
  technicals: AnalystReport,
  fundamentals: AnalystReport,
  news: AnalystReport,
  onToken?: (token: string) => void,
): Promise<SynthesisReport> {
  const prompt = `Symbol: ${symbol}

=== TECHNICAL ANALYST (confidence ${technicals.confidence}) ===
${technicals.summary}
Signals:
${technicals.signals.map((s) => `- ${s}`).join('\n')}

=== FUNDAMENTAL ANALYST (confidence ${fundamentals.confidence}) ===
${fundamentals.summary}
Signals:
${fundamentals.signals.map((s) => `- ${s}`).join('\n')}

=== NEWS ANALYST (confidence ${news.confidence}) ===
${news.summary}
Signals:
${news.signals.map((s) => `- ${s}`).join('\n')}

Produce the JSON verdict now.`;

  const text = await analyzeStream(prompt, { system: SYSTEM, onToken, maxTokens: 2048 });
  const parsed = extractJson<{
    verdict: string;
    confidence: number;
    headline: string;
    rationale: { technicals: string; fundamentals: string; news: string };
  }>(text);

  const verdict: Verdict = ['Buy', 'Hold', 'Sell'].includes(parsed.verdict)
    ? (parsed.verdict as Verdict)
    : 'Hold';

  const citations = [
    ...technicals.citations,
    ...fundamentals.citations,
    ...news.citations,
  ];

  return {
    verdict,
    confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
    headline: parsed.headline ?? `${symbol}: ${verdict}`,
    rationale: {
      technicals: parsed.rationale?.technicals ?? technicals.summary,
      fundamentals: parsed.rationale?.fundamentals ?? fundamentals.summary,
      news: parsed.rationale?.news ?? news.summary,
    },
    citations,
    generatedAt: new Date().toISOString(),
  };
}
