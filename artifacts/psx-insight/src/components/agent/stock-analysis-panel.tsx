import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, AlertCircle, Bot, ChevronDown, ChevronUp, History, Sparkles } from 'lucide-react';
import { CitationList, type Citation } from './citation-list';

type Verdict = 'Buy' | 'Hold' | 'Sell';

interface AnalystReport {
  summary: string;
  signals: string[];
  confidence: number;
  citations: Citation[];
}

interface SynthesisReport {
  verdict: Verdict;
  confidence: number;
  headline: string;
  rationale: { technicals: string; fundamentals: string; news: string };
  citations: Citation[];
  generatedAt: string;
}

interface AgentAnalyzeCachedResponse {
  cached: true;
  report: SynthesisReport;
  generatedAt: string;
  expiresAt: string;
}

interface HistoryEntry {
  id: number;
  generatedAt: string;
  expiresAt: string;
  verdict: Verdict | null;
  confidence: number | null;
  headline: string | null;
}

interface HistoryListResponse {
  symbol: string;
  entries: HistoryEntry[];
}

interface HistoryDetailResponse {
  id: number;
  report: SynthesisReport;
  generatedAt: string;
  expiresAt: string;
}

type Phase = 'idle' | 'gathering' | 'technicals' | 'fundamentals' | 'news' | 'synthesizing' | 'done' | 'error';
type Tab = 'latest' | 'history';

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Ready',
  gathering: 'Gathering data',
  technicals: 'Technical analyst running',
  fundamentals: 'Fundamental analyst running',
  news: 'News analyst running',
  synthesizing: 'Synthesizer producing verdict',
  done: 'Complete',
  error: 'Failed',
};

function verdictTone(v: Verdict | null) {
  if (v === 'Buy') return 'border-emerald-300/60 bg-emerald-400/15 text-emerald-200';
  if (v === 'Sell') return 'border-rose-300/60 bg-rose-400/15 text-rose-200';
  if (v === 'Hold') return 'border-amber-300/60 bg-amber-400/15 text-amber-200';
  return 'border-line bg-black/20 text-gray-400';
}

interface SSEEvent {
  event: string;
  data: unknown;
}

function parseSSEChunk(buffer: string): { events: SSEEvent[]; remainder: string } {
  const events: SSEEvent[] = [];
  let remainder = buffer;
  while (true) {
    const sep = remainder.indexOf('\n\n');
    if (sep < 0) break;
    const block = remainder.slice(0, sep);
    remainder = remainder.slice(sep + 2);
    let event = 'message';
    let dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length > 0) {
      try {
        events.push({ event, data: JSON.parse(dataLines.join('\n')) });
      } catch {
        // ignore malformed
      }
    }
  }
  return { events, remainder };
}

export function StockAnalysisPanel({ symbol }: { symbol: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('latest');
  const [phase, setPhase] = useState<Phase>('idle');
  const [streamingText, setStreamingText] = useState('');
  const [analysts, setAnalysts] = useState<{
    technicals?: AnalystReport;
    fundamentals?: AnalystReport;
    news?: AnalystReport;
  }>({});
  const [report, setReport] = useState<SynthesisReport | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [cachedHit, setCachedHit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);

  const [selectedHistoryId, setSelectedHistoryId] = useState<number | null>(null);
  const [historyReport, setHistoryReport] = useState<SynthesisReport | null>(null);
  const [historyReportAt, setHistoryReportAt] = useState<string | null>(null);
  const [historyDetailLoading, setHistoryDetailLoading] = useState(false);
  const [historyDetailError, setHistoryDetailError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const runAnalysis = useCallback(async () => {
    setOpen(true);
    setTab('latest');
    setRunning(true);
    setPhase('gathering');
    setStreamingText('');
    setAnalysts({});
    setReport(null);
    setError(null);
    setCachedHit(false);

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/agent/analyze/${encodeURIComponent(symbol)}`, {
        method: 'POST',
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Analysis failed (${res.status})`);
      }

      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const json = (await res.json()) as AgentAnalyzeCachedResponse;
        setReport(json.report);
        setGeneratedAt(json.generatedAt);
        setCachedHit(true);
        setPhase('done');
        setHistoryVersion((v) => v + 1);
        return;
      }

      if (!res.body) throw new Error('Streaming not supported by browser');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, remainder } = parseSSEChunk(buffer);
        buffer = remainder;
        for (const ev of events) {
          if (ev.event === 'phase') {
            const data = ev.data as { phase: Phase };
            setPhase(data.phase);
          } else if (ev.event === 'analyst') {
            const data = ev.data as { kind: 'technicals' | 'fundamentals' | 'news'; report: AnalystReport };
            setAnalysts((prev) => ({ ...prev, [data.kind]: data.report }));
          } else if (ev.event === 'token') {
            const data = ev.data as { text: string };
            setStreamingText((prev) => prev + data.text);
          } else if (ev.event === 'report') {
            const data = ev.data as { report: SynthesisReport };
            setReport(data.report);
            setGeneratedAt(data.report.generatedAt);
          } else if (ev.event === 'error') {
            const data = ev.data as { error: string };
            throw new Error(data.error);
          } else if (ev.event === 'done') {
            setPhase('done');
            setHistoryVersion((v) => v + 1);
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setPhase('error');
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setRunning(false);
    }
  }, [symbol]);

  // Load history list when the History tab is opened (or after a fresh report).
  useEffect(() => {
    if (!open || tab !== 'history' || !symbol) return;
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);
    fetch(`/api/agent/analyze/${encodeURIComponent(symbol)}/history`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Failed (${res.status})`);
        }
        return (await res.json()) as HistoryListResponse;
      })
      .then((json) => {
        if (cancelled) return;
        setHistory(json.entries);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setHistoryError(err instanceof Error ? err.message : 'Failed to load history');
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, tab, symbol, historyVersion]);

  // Load full report for the selected history entry.
  useEffect(() => {
    if (selectedHistoryId == null || !symbol) return;
    let cancelled = false;
    setHistoryDetailLoading(true);
    setHistoryDetailError(null);
    setHistoryReport(null);
    setHistoryReportAt(null);
    fetch(
      `/api/agent/analyze/${encodeURIComponent(symbol)}/history/${selectedHistoryId}`,
      { cache: 'no-store' },
    )
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Failed (${res.status})`);
        }
        return (await res.json()) as HistoryDetailResponse;
      })
      .then((json) => {
        if (cancelled) return;
        setHistoryReport(json.report);
        setHistoryReportAt(json.generatedAt);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setHistoryDetailError(err instanceof Error ? err.message : 'Failed to load report');
      })
      .finally(() => {
        if (!cancelled) setHistoryDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedHistoryId, symbol]);

  // Reset history selection when symbol changes.
  useEffect(() => {
    setSelectedHistoryId(null);
    setHistoryReport(null);
    setHistory([]);
    setHistoryVersion(0);
  }, [symbol]);

  const verdict = report?.verdict ?? null;

  return (
    <section className="rounded border border-line bg-panel p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded border border-coral/30 bg-coral/10 p-2 text-coral">
            <Bot className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">AI Analyst Panel</h2>
            <p className="mt-1 text-sm text-gray-500">
              Three Claude analysts (technical, fundamental, news) feed a synthesizer that issues a Buy / Hold / Sell call for {symbol}.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {report ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="rounded border border-line bg-black/20 px-3 py-2 text-sm text-gray-300 transition hover:border-coral/60 hover:text-coral"
              aria-label={open ? 'Collapse panel' : 'Expand panel'}
            >
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              setTab('history');
            }}
            className="flex items-center gap-2 rounded border border-line bg-black/20 px-3 py-2 text-sm text-gray-300 transition hover:border-coral/60 hover:text-coral"
          >
            <History className="h-4 w-4" aria-hidden="true" />
            History
          </button>
          <button
            type="button"
            onClick={runAnalysis}
            disabled={running}
            className="flex items-center gap-2 rounded border border-coral/60 bg-coral/15 px-4 py-2 text-sm font-semibold text-coral transition hover:bg-coral/25 disabled:opacity-60"
          >
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            {running ? 'Analyzing…' : report ? 'Re-analyze' : 'Analyze with AI'}
          </button>
        </div>
      </div>

      {open ? (
        <div className="mt-6 space-y-5">
          <div role="tablist" className="flex items-center gap-2 border-b border-line">
            <TabButton active={tab === 'latest'} onClick={() => setTab('latest')}>
              Latest
            </TabButton>
            <TabButton active={tab === 'history'} onClick={() => setTab('history')}>
              History
            </TabButton>
          </div>

          {tab === 'latest' ? (
            <LatestView
              phase={phase}
              error={error}
              running={running}
              analysts={analysts}
              report={report}
              streamingText={streamingText}
              cachedHit={cachedHit}
              generatedAt={generatedAt}
              verdict={verdict}
            />
          ) : (
            <HistoryView
              entries={history}
              loading={historyLoading}
              error={historyError}
              selectedId={selectedHistoryId}
              onSelect={setSelectedHistoryId}
              detailLoading={historyDetailLoading}
              detailError={historyDetailError}
              detailReport={historyReport}
              detailGeneratedAt={historyReportAt}
            />
          )}
        </div>
      ) : null}
    </section>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px rounded-t border-b-2 px-4 py-2 text-sm font-medium transition ${
        active
          ? 'border-coral text-coral'
          : 'border-transparent text-gray-400 hover:text-gray-200'
      }`}
    >
      {children}
    </button>
  );
}

function LatestView({
  phase,
  error,
  running,
  analysts,
  report,
  streamingText,
  cachedHit,
  generatedAt,
  verdict,
}: {
  phase: Phase;
  error: string | null;
  running: boolean;
  analysts: { technicals?: AnalystReport; fundamentals?: AnalystReport; news?: AnalystReport };
  report: SynthesisReport | null;
  streamingText: string;
  cachedHit: boolean;
  generatedAt: string | null;
  verdict: Verdict | null;
}) {
  return (
    <div className="space-y-5">
      {(running || phase !== 'idle') && phase !== 'error' && phase !== 'done' ? (
        <div className="flex items-center gap-3 rounded border border-coral/30 bg-coral/5 px-4 py-3 text-sm text-coral">
          <Activity className="h-4 w-4 animate-pulse" aria-hidden="true" />
          {PHASE_LABEL[phase]}
        </div>
      ) : null}

      {error ? (
        <div className="flex items-start gap-3 rounded border border-rose-400/40 bg-rose-400/10 p-4 text-sm text-rose-100">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Analysis failed</p>
            <p className="mt-1 text-rose-200/80">{error}</p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <AnalystCard title="Technical" report={analysts.technicals ?? (report ? { summary: report.rationale.technicals, signals: [], confidence: report.confidence, citations: [] } : undefined)} />
        <AnalystCard title="Fundamental" report={analysts.fundamentals ?? (report ? { summary: report.rationale.fundamentals, signals: [], confidence: report.confidence, citations: [] } : undefined)} />
        <AnalystCard title="News" report={analysts.news ?? (report ? { summary: report.rationale.news, signals: [], confidence: report.confidence, citations: [] } : undefined)} />
      </div>

      {streamingText && !report ? (
        <div className="rounded border border-line bg-black/30 p-4 text-xs leading-6 text-gray-300">
          <p className="mb-2 text-[11px] uppercase tracking-wide text-coral">Synthesizer (streaming raw JSON)</p>
          <pre className="whitespace-pre-wrap break-words font-mono text-[12px]">{streamingText}</pre>
        </div>
      ) : null}

      {report ? (
        <ReportCard report={report} verdict={verdict} freshnessLabel={cachedHit ? 'Cached' : 'Fresh'} generatedAt={generatedAt} />
      ) : null}
    </div>
  );
}

function HistoryView({
  entries,
  loading,
  error,
  selectedId,
  onSelect,
  detailLoading,
  detailError,
  detailReport,
  detailGeneratedAt,
}: {
  entries: HistoryEntry[];
  loading: boolean;
  error: string | null;
  selectedId: number | null;
  onSelect: (id: number) => void;
  detailLoading: boolean;
  detailError: string | null;
  detailReport: SynthesisReport | null;
  detailGeneratedAt: string | null;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Past reports</p>
          <span className="text-[11px] text-gray-600">{entries.length} stored</span>
        </div>
        {loading ? (
          <p className="rounded border border-line bg-black/15 px-3 py-4 text-xs text-gray-500">Loading history…</p>
        ) : error ? (
          <div className="flex items-start gap-2 rounded border border-rose-400/40 bg-rose-400/10 p-3 text-xs text-rose-100">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {error}
          </div>
        ) : entries.length === 0 ? (
          <p className="rounded border border-dashed border-line bg-black/10 px-3 py-4 text-xs text-gray-500">
            No saved reports yet. Run an analysis to start building history.
          </p>
        ) : (
          <ul className="space-y-2">
            {entries.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => onSelect(entry.id)}
                  className={`w-full rounded border px-3 py-3 text-left transition ${
                    selectedId === entry.id
                      ? 'border-coral/60 bg-coral/10'
                      : 'border-line bg-black/15 hover:border-coral/30 hover:bg-white/[0.03]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`rounded border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${verdictTone(entry.verdict)}`}
                    >
                      {entry.verdict ?? '—'}
                    </span>
                    <span className="text-[11px] text-gray-500">
                      {new Date(entry.generatedAt).toLocaleString()}
                    </span>
                  </div>
                  {entry.headline ? (
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-gray-200">{entry.headline}</p>
                  ) : (
                    <p className="mt-2 text-xs text-gray-500">No headline saved.</p>
                  )}
                  {entry.confidence != null ? (
                    <p className="mt-1 text-[11px] text-gray-500">Confidence {entry.confidence}/100</p>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="min-h-[240px]">
        {selectedId == null ? (
          <div className="grid h-full place-items-center rounded border border-dashed border-line bg-black/10 p-8 text-center text-sm text-gray-500">
            {entries.length > 0 ? 'Select a report on the left to view full details.' : 'Run an analysis to start building history.'}
          </div>
        ) : detailLoading ? (
          <p className="rounded border border-line bg-black/15 px-4 py-6 text-sm text-gray-500">Loading report…</p>
        ) : detailError ? (
          <div className="flex items-start gap-3 rounded border border-rose-400/40 bg-rose-400/10 p-4 text-sm text-rose-100">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">Failed to load report</p>
              <p className="mt-1 text-rose-200/80">{detailError}</p>
            </div>
          </div>
        ) : detailReport ? (
          <ReportCard
            report={detailReport}
            verdict={detailReport.verdict}
            freshnessLabel="Saved"
            generatedAt={detailGeneratedAt ?? detailReport.generatedAt}
          />
        ) : null}
      </div>
    </div>
  );
}

function ReportCard({
  report,
  verdict,
  freshnessLabel,
  generatedAt,
}: {
  report: SynthesisReport;
  verdict: Verdict | null;
  freshnessLabel: string;
  generatedAt: string | null;
}) {
  return (
    <div className="rounded border border-line bg-black/20 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className={`rounded border px-3 py-1 text-sm font-semibold uppercase tracking-wide ${verdictTone(verdict)}`}>
            {report.verdict}
          </span>
          <span className="text-sm text-gray-400">Confidence {report.confidence}/100</span>
        </div>
        <div className="text-xs text-gray-500">
          {freshnessLabel} · {generatedAt ? new Date(generatedAt).toLocaleString() : ''}
        </div>
      </div>
      <p className="mt-3 text-base font-semibold text-white">{report.headline}</p>
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <RationaleBlock title="Technicals" body={report.rationale.technicals} />
        <RationaleBlock title="Fundamentals" body={report.rationale.fundamentals} />
        <RationaleBlock title="News" body={report.rationale.news} />
      </div>
      <div className="mt-5">
        <CitationList citations={report.citations} />
      </div>
      <p className="mt-4 text-[11px] leading-5 text-gray-600">
        AI-generated analysis. Not investment advice. Verify before acting.
      </p>
    </div>
  );
}

function AnalystCard({ title, report }: { title: string; report?: AnalystReport }) {
  if (!report) {
    return (
      <div className="rounded border border-dashed border-line bg-black/10 p-4 text-xs text-gray-500">
        <p className="font-semibold uppercase tracking-wide text-gray-500">{title}</p>
        <p className="mt-2">Awaiting analyst…</p>
      </div>
    );
  }
  return (
    <div className="rounded border border-line bg-black/15 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-coral">{title}</p>
        <span className="text-[11px] text-gray-500">{report.confidence}/100</span>
      </div>
      <p className="mt-3 text-sm leading-6 text-gray-200">{report.summary}</p>
      {report.signals.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs text-gray-400">
          {report.signals.map((s, i) => (
            <li key={i}>• {s}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function RationaleBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded border border-line bg-black/20 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-coral">{title}</p>
      <p className="mt-2 text-sm leading-6 text-gray-200">{body}</p>
    </div>
  );
}
