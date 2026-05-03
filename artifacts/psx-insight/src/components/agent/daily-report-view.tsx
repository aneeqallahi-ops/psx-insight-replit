import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, History, RefreshCw, Sparkles, Sun } from 'lucide-react';
import { CitationList, type Citation } from './citation-list';

interface DailyMarketReport {
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

interface DailyReportResponse {
  cached: boolean;
  stale?: boolean;
  report: DailyMarketReport | null;
  generatedAt?: string;
  expiresAt?: string;
  message?: string;
}

interface HistoryEntry {
  id: number;
  generatedAt: string;
  expiresAt: string;
  asOf: string | null;
  headline: string | null;
}

interface HistoryDetail {
  id: number;
  report: DailyMarketReport;
  generatedAt: string;
  expiresAt: string;
}

type Tab = 'latest' | 'history';

export function DailyReportView() {
  const [tab, setTab] = useState<Tab>('latest');
  const [response, setResponse] = useState<DailyReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyRange, setHistoryRange] = useState<'all' | '7d' | '30d'>('all');
  const [historyDate, setHistoryDate] = useState<string>('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<HistoryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/agent/daily-report');
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Failed to load daily report (${res.status})`);
      }
      setResponse((await res.json()) as DailyReportResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load daily report');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch('/api/agent/daily-report/history');
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
      const res = await fetch(`/api/agent/daily-report/history/${id}`);
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

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (tab === 'history' && history === null && !historyLoading) {
      void loadHistory();
    }
  }, [tab, history, historyLoading, loadHistory]);
  useEffect(() => {
    if (selectedId !== null) void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  async function generateNow() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch('/api/agent/daily-report/refresh', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Generation failed (${res.status})`);
      }
      setResponse((await res.json()) as DailyReportResponse);
      setHistory(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setRefreshing(false);
    }
  }

  const latestReport = response?.report ?? null;
  const activeReport = tab === 'history' ? detail?.report ?? null : latestReport;
  const activeGeneratedAt = tab === 'history' ? detail?.generatedAt : latestReport?.generatedAt;

  return (
    <section className="border border-line bg-panel">
      <div className="flex flex-col gap-4 border-b border-line p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="border border-coral/40 bg-coral/10 p-2 text-coral">
            <Sun className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="font-display text-2xl text-white tracking-wide">DAILY MARKET BRIEFING</h2>
            <p className="mt-1 font-mono text-[11px] text-gray-500 uppercase tracking-wider">
              AI-GENERATED EOD DESK NOTE · AUTO-RUNS 16:30 PKT
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => load()}
            disabled={loading || refreshing}
            className="border border-line p-2 text-gray-300 transition hover:border-coral hover:text-coral disabled:opacity-50"
            aria-label="Reload latest"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={generateNow}
            disabled={loading || refreshing}
            className="flex items-center gap-2 border border-coral/60 bg-coral/15 px-4 py-2 font-mono text-xs uppercase tracking-wider font-semibold text-coral transition hover:bg-coral/25 disabled:opacity-60"
          >
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            {refreshing ? 'GENERATING…' : 'GENERATE NOW'}
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
          <Sun className="h-3.5 w-3.5" /> LATEST
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
        <div className="grid gap-0 md:grid-cols-[280px_1fr]">
          <aside className="border-b border-line md:border-b-0 md:border-r md:max-h-[600px] md:overflow-y-auto">
            <div className="border-b border-line p-3 space-y-2 bg-black/20">
              <div className="flex border border-line bg-black/30">
                {(['all', '7d', '30d'] as const).map((r) => (
                  <button key={r} type="button" onClick={() => { setHistoryRange(r); if (r !== 'all') setHistoryDate(''); }}
                    className={`flex-1 px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider transition ${historyRange === r ? 'bg-coral/15 text-coral' : 'text-gray-400 hover:text-white'}`}>
                    {r === 'all' ? 'ALL' : r === '7d' ? '7D' : '30D'}
                  </button>
                ))}
              </div>
              <input type="date" value={historyDate} onChange={(e) => { setHistoryDate(e.target.value); if (e.target.value) setHistoryRange('all'); }}
                className="w-full border border-line bg-black/30 px-2 py-1.5 font-mono text-[11px] text-white outline-none focus:border-coral" />
            </div>
            {historyError ? (
              <div className="m-3 border border-rose-400/40 bg-rose-400/10 p-3 font-mono text-xs text-rose-100">
                {historyError}
              </div>
            ) : null}
            {historyLoading && !history ? (
              <p className="p-4 font-mono text-xs text-gray-500">LOADING HISTORY…</p>
            ) : null}
            {history && history.length === 0 ? (
              <p className="p-4 font-mono text-xs text-gray-500">No archived reports yet.</p>
            ) : null}
            <ul>
              {(history ?? []).filter((entry) => {
                const generatedTs = new Date(entry.generatedAt).getTime();
                if (historyDate) {
                  const target = new Date(historyDate + 'T00:00:00Z').getTime();
                  const next = target + 24 * 3600 * 1000;
                  if (generatedTs < target || generatedTs >= next) return false;
                }
                if (historyRange !== 'all') {
                  const days = historyRange === '7d' ? 7 : 30;
                  if (Date.now() - generatedTs > days * 24 * 3600 * 1000) return false;
                }
                return true;
              }).map((entry) => {
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
                      {entry.asOf ? (
                        <p className="mt-1 font-mono text-[10px] uppercase opacity-50">AS OF {entry.asOf}</p>
                      ) : null}
                      <p className="mt-1 text-sm font-medium line-clamp-2">{entry.headline ?? 'Untitled report'}</p>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>
          <div className="p-5">
            {selectedId === null ? (
              <p className="font-mono text-xs text-gray-500">Select a report from the archive to view.</p>
            ) : detailError ? (
              <div className="border border-rose-400/40 bg-rose-400/10 p-4 font-mono text-xs text-rose-100">
                {detailError}
              </div>
            ) : detailLoading || !activeReport ? (
              <p className="font-mono text-xs text-gray-500">LOADING REPORT…</p>
            ) : (
              <ReportBody report={activeReport} generatedAt={activeGeneratedAt} />
            )}
          </div>
        </div>
      ) : (
        <div className="p-5">
          {error ? (
            <div className="mb-4 flex items-start gap-3 border border-rose-400/40 bg-rose-400/10 p-4 font-mono text-xs text-rose-100">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">COULD NOT LOAD</p>
                <p className="mt-1">{error}</p>
              </div>
            </div>
          ) : null}

          {response?.message && !latestReport ? (
            <div className="border border-line bg-black/20 p-5 font-mono text-xs text-gray-300">
              {response.message}
            </div>
          ) : null}

          {response?.stale ? (
            <div className="mb-4 border border-amber-300/40 bg-amber-400/10 p-3 font-mono text-[11px] text-amber-100">
              {response.message ?? 'Showing the most recent available report.'}
            </div>
          ) : null}

          {latestReport ? (
            <ReportBody report={latestReport} generatedAt={activeGeneratedAt} />
          ) : null}
        </div>
      )}
    </section>
  );
}

function ReportBody({ report, generatedAt }: { report: DailyMarketReport; generatedAt?: string }) {
  return (
    <div className="space-y-5">
      <div className="border border-line bg-black/20 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="border border-coral/40 bg-coral/10 px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-coral">
            AS OF {report.asOf}
          </span>
          <span className="font-mono text-[11px] text-gray-500">
            GENERATED {generatedAt ? new Date(generatedAt).toLocaleString() : new Date(report.generatedAt).toLocaleString()}
          </span>
        </div>
        <p className="mt-3 font-display text-xl text-white tracking-wide">{report.headline}</p>
        <p className="mt-2 text-sm leading-6 text-gray-300">{report.summary}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Block title="Top picks">
          {report.topPicks.length > 0 ? (
            <ul className="space-y-3 text-sm text-gray-200">
              {report.topPicks.map((p) => (
                <li key={p.symbol}>
                  <p className="font-mono font-semibold text-coral">{p.symbol}</p>
                  <p className="mt-1 text-gray-300">{p.reason}</p>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-gray-500">None highlighted today.</p>}
        </Block>

        <Block title="Breadth signal">
          <p className="text-sm leading-6 text-gray-200">{report.breadthSignal || 'No breadth commentary.'}</p>
        </Block>

        <Block title="Sectors in favor" tone="emerald">
          {report.sectorsInFavor.length > 0 ? (
            <ul className="space-y-2 text-sm text-emerald-100/90">
              {report.sectorsInFavor.map((s) => (
                <li key={s.sector}>
                  <p className="font-semibold">{s.sector}</p>
                  <p className="mt-1 text-emerald-100/70">{s.reason}</p>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-gray-500">None highlighted.</p>}
        </Block>

        <Block title="Sectors out of favor" tone="rose">
          {report.sectorsOutOfFavor.length > 0 ? (
            <ul className="space-y-2 text-sm text-rose-100/90">
              {report.sectorsOutOfFavor.map((s) => (
                <li key={s.sector}>
                  <p className="font-semibold">{s.sector}</p>
                  <p className="mt-1 text-rose-100/70">{s.reason}</p>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-gray-500">None highlighted.</p>}
        </Block>
      </div>

      <Block title="Macro & news take">
        <p className="text-sm leading-6 text-gray-200">{report.macroNewsSummary || 'No macro commentary.'}</p>
      </Block>

      <CitationList citations={report.citations} />

      <p className="font-mono text-[10px] uppercase tracking-wider leading-5 text-gray-600">
        AI-GENERATED · NOT INVESTMENT ADVICE · VERIFY BEFORE ACTING
      </p>
    </div>
  );
}

function Block({ title, tone, children }: { title: string; tone?: 'emerald' | 'rose'; children: React.ReactNode }) {
  const border = tone === 'emerald' ? 'border-emerald-300/30 bg-emerald-400/5' : tone === 'rose' ? 'border-rose-300/30 bg-rose-400/5' : 'border-line bg-black/20';
  const titleTone = tone === 'emerald' ? 'text-emerald-200' : tone === 'rose' ? 'text-rose-200' : 'text-coral';
  return (
    <section className={`border ${border} p-4`}>
      <h3 className={`font-mono text-[11px] font-semibold uppercase tracking-wider ${titleTone}`}>{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}
