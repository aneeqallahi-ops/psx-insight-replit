import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ClipboardCheck, History, RefreshCw, X } from 'lucide-react';
import { getPortfolioKey } from '@/lib/portfolio';
import { CitationList, type Citation } from './citation-list';

interface PortfolioReviewReport {
  healthScore: number;
  headline: string;
  summary: string;
  perPosition: { symbol: string; commentary: string }[];
  risks: string[];
  rebalanceSuggestions: string[];
  citations: Citation[];
  generatedAt: string;
  positionsAnalyzed: number;
}

interface PortfolioReviewResponse {
  cached: boolean;
  report: PortfolioReviewReport;
  generatedAt: string;
  expiresAt: string;
}

interface HistoryEntry {
  id: number;
  generatedAt: string;
  expiresAt: string;
  healthScore: number | null;
  headline: string | null;
  positionsAnalyzed: number | null;
}

interface HistoryDetail {
  id: number;
  report: PortfolioReviewReport;
  generatedAt: string;
  expiresAt: string;
}

type Tab = 'latest' | 'history';

function healthTone(score: number) {
  if (score >= 70) return 'border-emerald-300/60 bg-emerald-400/15 text-emerald-200';
  if (score >= 40) return 'border-amber-300/60 bg-amber-400/15 text-amber-200';
  return 'border-rose-300/60 bg-rose-400/15 text-rose-200';
}

export function PortfolioReviewModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('latest');
  const [report, setReport] = useState<PortfolioReviewReport | null>(null);
  const [meta, setMeta] = useState<{ cached: boolean; generatedAt: string; expiresAt: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<HistoryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(async (force: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const url = force ? '/api/agent/portfolio-review?force=1' : '/api/agent/portfolio-review';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'X-Portfolio-Key': getPortfolioKey() },
      });
      const json = (await res.json()) as PortfolioReviewResponse | { error: string };
      if (!res.ok || 'error' in json) {
        throw new Error(('error' in json ? json.error : '') || `Review failed (${res.status})`);
      }
      setReport(json.report);
      setMeta({ cached: json.cached, generatedAt: json.generatedAt, expiresAt: json.expiresAt });
      if (force) setHistory(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Portfolio review failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch('/api/agent/portfolio-review/history', {
        headers: { 'X-Portfolio-Key': getPortfolioKey() },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Failed to load history (${res.status})`);
      }
      const json = (await res.json()) as { entries: HistoryEntry[] };
      setHistory(json.entries);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    try {
      const res = await fetch(`/api/agent/portfolio-review/history/${id}`, {
        headers: { 'X-Portfolio-Key': getPortfolioKey() },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Failed to load report (${res.status})`);
      }
      setDetail((await res.json()) as HistoryDetail);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Failed to load report');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => { void load(false); }, [load]);
  useEffect(() => {
    if (tab === 'history' && history === null && !historyLoading) {
      void loadHistory();
    }
  }, [tab, history, historyLoading, loadHistory]);
  useEffect(() => {
    if (selectedId !== null) void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const activeReport = tab === 'history' ? detail?.report ?? null : report;
  const activeGeneratedAt = tab === 'history' ? detail?.generatedAt : meta?.generatedAt;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 px-4 py-8 overflow-y-auto">
      <div className="w-full max-w-4xl border border-line bg-panel shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="border border-coral/40 bg-coral/10 p-2 text-coral">
              <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-display text-2xl text-white tracking-wide">PORTFOLIO REVIEW</h2>
              <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-gray-500">
                AI REVIEW ACROSS ACTIVE POSITIONS
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {tab === 'latest' ? (
              <button
                type="button"
                onClick={() => load(true)}
                disabled={loading}
                className="flex items-center gap-1.5 border border-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-gray-300 transition hover:border-coral hover:text-coral disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                {loading ? 'REVIEWING…' : 'REFRESH'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="border border-line p-2 text-gray-400 transition hover:text-white"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex border-b border-line bg-black/20">
          <button
            type="button"
            onClick={() => { setTab('latest'); setSelectedId(null); setDetail(null); }}
            className={`flex items-center gap-2 px-5 py-3 font-mono text-xs uppercase tracking-wider transition border-b-2 ${
              tab === 'latest' ? 'border-coral text-coral' : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <ClipboardCheck className="h-3.5 w-3.5" /> LATEST
          </button>
          <button
            type="button"
            onClick={() => setTab('history')}
            className={`flex items-center gap-2 px-5 py-3 font-mono text-xs uppercase tracking-wider transition border-b-2 ${
              tab === 'history' ? 'border-coral text-coral' : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <History className="h-3.5 w-3.5" /> HISTORY
          </button>
        </div>

        {tab === 'history' ? (
          <div className="grid gap-0 md:grid-cols-[280px_1fr] max-h-[70vh]">
            <aside className="border-b border-line md:border-b-0 md:border-r overflow-y-auto">
              {historyError ? (
                <div className="m-3 border border-rose-400/40 bg-rose-400/10 p-3 font-mono text-xs text-rose-100">
                  {historyError}
                </div>
              ) : null}
              {historyLoading && !history ? (
                <p className="p-4 font-mono text-xs text-gray-500">LOADING HISTORY…</p>
              ) : null}
              {history && history.length === 0 ? (
                <p className="p-4 font-mono text-xs text-gray-500">No archived reviews yet.</p>
              ) : null}
              <ul>
                {(history ?? []).map((entry) => {
                  const active = entry.id === selectedId;
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(entry.id)}
                        className={`w-full text-left border-b border-line/60 px-4 py-3 transition ${
                          active ? 'bg-coral/10 text-coral' : 'text-gray-300 hover:bg-coral/5 hover:text-white'
                        }`}
                      >
                        <p className="font-mono text-[10px] uppercase tracking-wider opacity-60">
                          {new Date(entry.generatedAt).toLocaleString()}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          {entry.healthScore !== null ? (
                            <span className={`border px-1.5 py-0.5 font-mono text-[10px] ${healthTone(entry.healthScore)}`}>
                              {entry.healthScore}/100
                            </span>
                          ) : null}
                          {entry.positionsAnalyzed !== null ? (
                            <span className="font-mono text-[10px] opacity-50">{entry.positionsAnalyzed} POS</span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm font-medium line-clamp-2">{entry.headline ?? 'Untitled review'}</p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>
            <div className="overflow-y-auto p-5">
              {selectedId === null ? (
                <p className="font-mono text-xs text-gray-500">Select an archived review to view.</p>
              ) : detailError ? (
                <div className="border border-rose-400/40 bg-rose-400/10 p-4 font-mono text-xs text-rose-100">
                  {detailError}
                </div>
              ) : detailLoading || !activeReport ? (
                <p className="font-mono text-xs text-gray-500">LOADING REPORT…</p>
              ) : (
                <ReviewBody report={activeReport} generatedAt={activeGeneratedAt} cached={true} />
              )}
            </div>
          </div>
        ) : (
          <div className="max-h-[70vh] overflow-y-auto p-6 space-y-5">
            {loading && !report ? (
              <div className="grid place-items-center py-12 font-mono text-xs text-gray-400">
                <p>REVIEWING WITH AI DESK…</p>
                <p className="mt-2 opacity-60">PULLS FUNDAMENTALS, SYNTHESIZES NOTE</p>
              </div>
            ) : null}

            {error ? (
              <div className="flex items-start gap-3 border border-rose-400/40 bg-rose-400/10 p-4 font-mono text-xs text-rose-100">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-semibold">REVIEW FAILED</p>
                  <p className="mt-1">{error}</p>
                </div>
              </div>
            ) : null}

            {report ? (
              <ReviewBody report={report} generatedAt={activeGeneratedAt} cached={meta?.cached ?? false} />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewBody({ report, generatedAt, cached }: { report: PortfolioReviewReport; generatedAt?: string; cached: boolean }) {
  return (
    <>
      <div className="flex flex-col gap-3 border border-line bg-black/20 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className={`border px-3 py-1 font-mono text-sm font-semibold ${healthTone(report.healthScore)}`}>
            HEALTH {report.healthScore}/100
          </span>
          <span className="font-mono text-[11px] text-gray-500 uppercase">
            {cached ? 'CACHED' : 'FRESH'} · {generatedAt ? new Date(generatedAt).toLocaleString() : ''} · {report.positionsAnalyzed} POSITIONS
          </span>
        </div>
        <p className="font-display text-xl text-white tracking-wide">{report.headline}</p>
        <p className="text-sm leading-6 text-gray-300">{report.summary}</p>
      </div>

      {report.perPosition.length > 0 ? (
        <section className="border border-line bg-black/15 p-5 mt-5">
          <h3 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-coral">PER-POSITION NOTES</h3>
          <ul className="mt-3 space-y-3 text-sm text-gray-300">
            {report.perPosition.map((p) => (
              <li key={p.symbol} className="border-l-2 border-coral/40 pl-3">
                <p className="font-mono font-semibold text-coral">{p.symbol}</p>
                <p className="mt-1 leading-6">{p.commentary}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {report.risks.length > 0 ? (
          <section className="border border-rose-300/30 bg-rose-400/5 p-4">
            <h3 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-rose-200">RISKS</h3>
            <ul className="mt-3 space-y-2 text-sm text-rose-100/90">
              {report.risks.map((r, i) => <li key={i}>• {r}</li>)}
            </ul>
          </section>
        ) : null}
        {report.rebalanceSuggestions.length > 0 ? (
          <section className="border border-emerald-300/30 bg-emerald-400/5 p-4">
            <h3 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-emerald-200">REBALANCE SUGGESTIONS</h3>
            <ul className="mt-3 space-y-2 text-sm text-emerald-100/90">
              {report.rebalanceSuggestions.map((r, i) => <li key={i}>• {r}</li>)}
            </ul>
          </section>
        ) : null}
      </div>

      <div className="mt-5">
        <CitationList citations={report.citations} />
      </div>

      <p className="mt-3 font-mono text-[10px] uppercase tracking-wider leading-5 text-gray-600">
        AI-GENERATED REVIEW · NOT INVESTMENT ADVICE
      </p>
    </>
  );
}
