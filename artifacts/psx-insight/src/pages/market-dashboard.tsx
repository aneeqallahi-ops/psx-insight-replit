import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, FileText, LineChart, X } from 'lucide-react';
import { Link } from 'wouter';
import { useEffect, useMemo, useState } from 'react';
import { useMarketStatus } from '@/hooks/useMarketStatus';
import type { MarketStats, SectorData, TopMover } from '@/lib/types';

interface MarketOverviewResponse {
  stats: MarketStats;
  symbolsCount: number;
  scope: MarketScope;
  asOfTimestamp?: string | null;
  updatedAt: number;
}

interface SectorStatsResponse {
  sectors: Record<string, SectorData>;
  updatedAt: number;
}

interface MarketRow {
  symbol: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  value: number | null;
  sector: string;
}

interface MarketsResponse { rows: MarketRow[]; updatedAt: number; }

interface IndexResponse {
  code: string;
  close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  change: number;
  changePercent: number;
  asOfTimestamp: number;
  updatedAt: number;
}

interface MoversResponse {
  range: '1d' | '1w' | '1m';
  gainers: TopMover[];
  losers: TopMover[];
  updatedAt: number;
}

type MarketScope = 'all' | 'kse100';
type MoversRange = '1d' | '1w' | '1m';

function compactNumber(value: number) { return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value); }
function money(value: number) { return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2, style: 'currency', currency: 'PKR' }).format(value); }
function percent(value: number) { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, style: 'percent' }).format(value); }
function signedPercent(value: number) { const f = percent(value); return value > 0 ? `+${f}` : f; }
function titleCaseSector(value: string) { return value.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (l) => l.toUpperCase()); }

function formatAsOfDate(iso: string | number | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi',
  }).format(d).toUpperCase();
}

async function fetchMarketOverview(scope: MarketScope): Promise<MarketOverviewResponse> {
  const res = await fetch(`/api/market/overview?scope=${scope}`, { cache: 'no-store' });
  if (!res.ok) { const p = await res.json().catch(() => null); throw new Error(p?.error || 'Unable to load overview'); }
  return res.json();
}
async function fetchSectorStats(): Promise<SectorStatsResponse> {
  const res = await fetch('/api/market/sectors', { cache: 'no-store' });
  if (!res.ok) { const p = await res.json().catch(() => null); throw new Error(p?.error || 'Unable to load sectors'); }
  return res.json();
}
async function fetchMarkets(): Promise<MarketsResponse> {
  const res = await fetch('/api/markets?scope=all', { cache: 'no-store' });
  if (!res.ok) { const p = await res.json().catch(() => null); throw new Error(p?.error || 'Unable to load rows'); }
  return res.json();
}
async function fetchKseIndex(): Promise<IndexResponse> {
  const res = await fetch('/api/market/index?code=KSE100', { cache: 'no-store' });
  if (!res.ok) { const p = await res.json().catch(() => null); throw new Error(p?.error || 'Unable to load KSE-100'); }
  return res.json();
}
async function fetchMovers(range: MoversRange, scope: MarketScope): Promise<MoversResponse> {
  const res = await fetch(`/api/market/movers?range=${range}&scope=${scope}`, { cache: 'no-store' });
  if (!res.ok) { const p = await res.json().catch(() => null); throw new Error(p?.error || 'Unable to load movers'); }
  return res.json();
}

function SectionTag({ code, label }: { code: string; label: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="font-mono text-[10px] text-coral tracking-widest">{code} //</span>
      <h2 className="font-display text-2xl text-white tracking-wide">{label}</h2>
      <span className="flex-1 h-px bg-coral/20" />
    </div>
  );
}

function StatTile({ label, value, detail, accent }: { label: string; value: string; detail: string; accent?: string }) {
  return (
    <div className="border border-line bg-panel p-5 clip-notch">
      <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500">{label}</p>
      <p className={`mt-3 font-display text-3xl tracking-wide ${accent ?? 'text-white'}`}>{value}</p>
      <p className="mt-2 font-mono text-[11px] text-gray-500">{detail}</p>
    </div>
  );
}

function MoverRow({ mover, tone }: { mover: TopMover; tone: 'up' | 'down' }) {
  const Icon = tone === 'up' ? ArrowUpRight : ArrowDownRight;
  const toneClass = tone === 'up' ? 'text-emerald-300' : 'text-rose-300';
  return (
    <div className="grid grid-cols-[1fr_auto] gap-4 border-b border-line py-3 last:border-b-0">
      <div>
        <Link href={`/stock?symbol=${encodeURIComponent(mover.symbol)}`} className="font-mono text-sm font-semibold text-white hover:text-coral">
          {mover.symbol}
        </Link>
        <p className="mt-1 font-mono text-[10px] text-gray-500">VOL {compactNumber(mover.volume)}</p>
      </div>
      <div className="text-right">
        <p className="font-mono text-sm text-gray-200">{mover.price.toFixed(2)}</p>
        <p className={`mt-1 flex items-center justify-end gap-1 font-mono text-xs font-semibold ${toneClass}`}>
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          {percent(mover.changePercent)}
        </p>
      </div>
    </div>
  );
}

function HeroBlock({ asOfLabel }: { asOfLabel: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['kse-index'],
    queryFn: fetchKseIndex,
    refetchInterval: 60_000,
  });
  const positive = (data?.change ?? 0) >= 0;
  return (
    <section className="border border-coral/40 bg-gradient-to-br from-coral/10 via-panel to-panel p-6 lg:p-8 clip-notch">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex-1">
          <p className="font-mono text-[10px] tracking-widest text-coral">// KSE-100 INDEX · CLOSE</p>
          <div className="mt-3 flex flex-wrap items-baseline gap-4">
            <p className="font-display text-6xl tracking-tight text-white lg:text-8xl">
              {data ? data.close.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : isLoading ? '—' : '—'}
            </p>
            {data ? (
              <p className={`font-display text-2xl lg:text-4xl ${positive ? 'text-emerald-300' : 'text-rose-300'}`}>
                {positive ? '▲' : '▼'} {data.change.toFixed(2)} ({signedPercent(data.changePercent)})
              </p>
            ) : null}
          </div>
          <p className="mt-3 font-mono text-[11px] uppercase tracking-wider text-gray-400">
            AS OF {asOfLabel || (data ? formatAsOfDate(data.asOfTimestamp) : '—')} · LAST OPERATING DAY
          </p>
          {error ? (
            <p className="mt-2 font-mono text-[11px] text-rose-300">{error instanceof Error ? error.message : 'Index unavailable'}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
          <Link
            href="/markets"
            className="inline-flex items-center justify-center gap-2 border border-coral bg-coral px-5 py-3 font-mono text-xs font-semibold uppercase tracking-wider text-canvas transition hover:bg-coral/80"
          >
            <LineChart className="h-4 w-4" /> View Markets
          </Link>
          <Link
            href="/analysis"
            className="inline-flex items-center justify-center gap-2 border border-coral/60 bg-coral/10 px-5 py-3 font-mono text-xs font-semibold uppercase tracking-wider text-coral transition hover:bg-coral/20"
          >
            <FileText className="h-4 w-4" /> Run AI Briefing
          </Link>
        </div>
      </div>
    </section>
  );
}

function sectorBackground(changePercent: number) {
  if (changePercent > 0.02) return 'rgba(16, 163, 74, 0.85)';
  if (changePercent > 0) return 'rgba(74, 222, 128, 0.30)';
  if (changePercent === 0) return 'rgba(30, 41, 59, 0.6)';
  if (changePercent >= -0.02) return 'rgba(248, 113, 113, 0.30)';
  return 'rgba(220, 38, 38, 0.85)';
}

function SectorDetailModal({ sectorKey, summary, onClose, isMarketOpen }: {
  sectorKey: string;
  summary: SectorData;
  onClose: () => void;
  isMarketOpen: boolean;
}) {
  const { data: marketRows, error: marketRowsError, isFetching: isMarketRowsFetching } = useQuery({
    queryKey: ['markets-for-sector-detail'],
    queryFn: fetchMarkets,
    refetchInterval: isMarketOpen ? 60_000 : false,
    refetchOnWindowFocus: isMarketOpen,
  });
  const sectorRows = useMemo(() => {
    const sectorSymbols = new Set(summary.symbols);
    return (marketRows?.rows ?? [])
      .filter((row) => sectorSymbols.has(row.symbol))
      .map((row) => ({
        symbol: row.symbol, price: row.price, change: row.change, changePercent: row.changePercent, volume: row.volume,
        state: (row.change ?? 0) > 0 ? 'up' : (row.change ?? 0) < 0 ? 'down' : 'unchanged' as const,
      }))
      .sort((a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity));
  }, [marketRows?.rows, summary.symbols]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6" role="dialog" aria-modal="true" aria-label={`${titleCaseSector(sectorKey)} sector detail`}>
      <button type="button" aria-label="Close sector detail" className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-4xl max-h-[85vh] overflow-y-auto border border-coral/40 bg-panel p-6 clip-notch shadow-2xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between border-b border-line pb-4">
          <div>
            <p className="font-mono text-[10px] tracking-widest text-coral">// SECTOR DETAIL</p>
            <h3 className="mt-1 font-display text-3xl text-white tracking-wide">{titleCaseSector(sectorKey).toUpperCase()}</h3>
            <p className="mt-1 font-mono text-[11px] text-gray-500">
              {isMarketRowsFetching ? 'REFRESHING…' : marketRows ? `UPDATED ${new Date(marketRows.updatedAt).toLocaleTimeString()}` : 'LOADING…'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="self-start border border-line p-2 text-gray-300 transition hover:border-coral hover:text-coral">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="border border-line bg-black/30 p-3">
            <p className="font-mono text-[10px] uppercase text-gray-500">AVG CHANGE</p>
            <p className={`mt-2 font-display text-2xl ${summary.avgChangePercent >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{signedPercent(summary.avgChangePercent)}</p>
          </div>
          <div className="border border-line bg-black/30 p-3">
            <p className="font-mono text-[10px] uppercase text-gray-500">BREADTH</p>
            <p className="mt-2 font-display text-2xl text-white">▲ {summary.gainers} · ▼ {summary.losers}</p>
          </div>
          <div className="border border-line bg-black/30 p-3">
            <p className="font-mono text-[10px] uppercase text-gray-500">VOLUME</p>
            <p className="mt-2 font-display text-2xl text-white">{compactNumber(summary.totalVolume)}</p>
          </div>
        </div>
        {marketRowsError ? (
          <div className="mt-4 border border-rose-400/30 bg-rose-400/10 p-4 font-mono text-xs text-rose-100">
            {marketRowsError instanceof Error ? marketRowsError.message : 'Unable to load sector stocks'}
          </div>
        ) : null}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line font-mono text-[10px] uppercase text-gray-500">
                <th className="py-2 pr-4">Symbol</th><th className="px-3 py-2">Price</th><th className="px-3 py-2">Change</th><th className="px-3 py-2">Change %</th><th className="px-3 py-2">Volume</th>
              </tr>
            </thead>
            <tbody>
              {sectorRows.length ? sectorRows.map((row) => {
                const toneClass = row.state === 'up' ? 'text-emerald-300' : row.state === 'down' ? 'text-rose-300' : 'text-gray-300';
                return (
                  <tr key={row.symbol} className="border-b border-line/60 transition hover:bg-coral/5">
                    <td className="py-2 pr-4 font-mono font-medium text-white">
                      <Link href={`/stock?symbol=${encodeURIComponent(row.symbol)}`} className="hover:text-coral" onClick={onClose}>{row.symbol}</Link>
                    </td>
                    <td className="px-3 py-2 font-mono text-gray-200">{row.price === null ? '--' : row.price.toFixed(2)}</td>
                    <td className={`px-3 py-2 font-mono ${toneClass}`}>{row.change === null ? '--' : row.change.toFixed(2)}</td>
                    <td className={`px-3 py-2 font-mono ${toneClass}`}>{row.changePercent === null ? '--' : signedPercent(row.changePercent)}</td>
                    <td className="px-3 py-2 font-mono text-gray-300">{row.volume === null ? '--' : compactNumber(row.volume)}</td>
                  </tr>
                );
              }) : (
                <tr><td className="py-4 font-mono text-xs text-gray-500" colSpan={5}>{isMarketRowsFetching ? 'LOADING…' : 'NO DATA'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SectorHeatmap({ sectors, isLoading, error, isMarketOpen }: { sectors?: Record<string, SectorData>; isLoading: boolean; error: unknown; isMarketOpen: boolean }) {
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const sectorEntries = useMemo(
    () => Object.entries(sectors ?? {}).sort(([, a], [, b]) => b.avgChangePercent - a.avgChangePercent),
    [sectors],
  );
  const selectedSectorSummary = selectedSector ? sectors?.[selectedSector] : undefined;

  return (
    <section>
      <SectionTag code="003" label="SECTOR HEATMAP" />
      <div className="border border-line bg-panel p-5">
        <p className="font-mono text-[10px] uppercase text-gray-500 mb-4">
          {isMarketOpen ? 'REFRESHES EVERY 15S · CLICK A SECTOR FOR DETAILS' : 'MARKET CLOSED · CLICK A SECTOR FOR DETAILS'}
        </p>
        {error ? (
          <div className="border border-rose-400/30 bg-rose-400/10 p-4 font-mono text-xs text-rose-100 mb-4">
            {error instanceof Error ? error.message : 'Unable to load sector performance'}
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {sectorEntries.length > 0
            ? sectorEntries.map(([sector, data]) => (
                <button type="button" key={sector} onClick={() => setSelectedSector(sector)}
                  className="min-h-32 border border-white/10 p-4 text-left transition hover:border-coral hover:brightness-110 hover:scale-[1.02]"
                  style={{ backgroundColor: sectorBackground(data.avgChangePercent) }}>
                  <p className="font-mono text-[11px] font-semibold uppercase text-white">{titleCaseSector(sector)}</p>
                  <p className="mt-3 font-display text-3xl text-white">{signedPercent(data.avgChangePercent)}</p>
                  <p className="mt-2 font-mono text-[11px] text-gray-100">▲ {data.gainers}  ▼ {data.losers}</p>
                  <p className="mt-1 font-mono text-[11px] text-gray-200">VOL {compactNumber(data.totalVolume)}</p>
                </button>
              ))
            : Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="min-h-32 border border-line bg-black/10 p-4">
                  <p className="font-mono text-xs text-gray-500">{isLoading ? 'LOADING…' : 'NO DATA'}</p>
                </div>
              ))}
        </div>
      </div>
      {selectedSector && selectedSectorSummary ? (
        <SectorDetailModal sectorKey={selectedSector} summary={selectedSectorSummary} onClose={() => setSelectedSector(null)} isMarketOpen={isMarketOpen} />
      ) : null}
    </section>
  );
}

const RANGE_LABEL: Record<MoversRange, string> = { '1d': 'TODAY', '1w': '1W', '1m': '1M' };

function LiveSymbolsTable({ asOfLabel, fallbackStats, scope }: { asOfLabel: string; fallbackStats?: MarketStats; scope: MarketScope }) {
  const [activeTab, setActiveTab] = useState<'gainers' | 'losers'>('gainers');
  const [range, setRange] = useState<MoversRange>('1d');
  const [search, setSearch] = useState('');
  const { data, isFetching, error } = useQuery({
    queryKey: ['movers', range, scope],
    queryFn: () => fetchMovers(range, scope),
  });
  const source = useMemo(() => {
    if (data) return activeTab === 'gainers' ? data.gainers : data.losers;
    if (range === '1d' && fallbackStats) return activeTab === 'gainers' ? fallbackStats.topGainers : fallbackStats.topLosers;
    return [];
  }, [activeTab, data, fallbackStats, range]);
  const rows = useMemo(() => {
    const query = search.trim().toUpperCase();
    return (source ?? []).filter((m) => (query ? m.symbol.toUpperCase().includes(query) : true)).slice(0, 15);
  }, [source, search]);

  return (
    <section>
      <SectionTag code="004" label="LIVE TAPE" />
      <div className="border border-line bg-panel p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex border border-line bg-black/30">
              <button type="button" onClick={() => setActiveTab('gainers')} className={`px-4 py-2 font-mono text-xs uppercase tracking-wider transition ${activeTab === 'gainers' ? 'bg-coral/15 text-coral' : 'text-gray-400 hover:text-white'}`}>Top Gainers</button>
              <button type="button" onClick={() => setActiveTab('losers')} className={`px-4 py-2 font-mono text-xs uppercase tracking-wider transition ${activeTab === 'losers' ? 'bg-coral/15 text-coral' : 'text-gray-400 hover:text-white'}`}>Top Losers</button>
            </div>
            <div className="flex border border-line bg-black/30" role="group" aria-label="Range">
              {(Object.keys(RANGE_LABEL) as MoversRange[]).map((r) => (
                <button key={r} type="button" onClick={() => setRange(r)} className={`px-3 py-2 font-mono text-[11px] uppercase tracking-wider transition ${range === r ? 'bg-coral/15 text-coral' : 'text-gray-400 hover:text-white'}`}>
                  {RANGE_LABEL[r]}
                </button>
              ))}
            </div>
          </div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="FILTER SYMBOL" className="h-10 border border-line bg-black/30 px-3 font-mono text-xs uppercase text-white outline-none placeholder:text-gray-600 focus:border-coral" />
        </div>
        {error ? (
          <p className="mt-3 font-mono text-[11px] text-rose-300">{error instanceof Error ? error.message : 'Unable to load movers'}</p>
        ) : null}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line font-mono text-[10px] uppercase text-gray-500">
                <th className="py-3 pr-4">Symbol</th><th className="px-4 py-3">Price</th><th className="px-4 py-3">Change</th><th className="px-4 py-3">Change %</th><th className="px-4 py-3">Volume</th><th className="py-3 pl-4">Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.length > 0 ? rows.map((mover) => {
                const isPositive = mover.change >= 0;
                const toneClass = isPositive ? 'text-emerald-300' : 'text-rose-300';
                const arrow = isPositive ? '▲' : '▼';
                return (
                  <tr key={`${activeTab}-${range}-${mover.symbol}`} className="border-b border-line/60 transition hover:bg-coral/5">
                    <td className="py-3 pr-4 font-mono font-medium text-white">
                      <Link href={`/stock?symbol=${encodeURIComponent(mover.symbol)}`} className="hover:text-coral">{mover.symbol}</Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-200">{mover.price.toFixed(2)}</td>
                    <td className={`px-4 py-3 font-mono ${toneClass}`}>{arrow} {mover.change.toFixed(2)}</td>
                    <td className={`px-4 py-3 font-mono ${toneClass}`}>{arrow} {signedPercent(mover.changePercent)}</td>
                    <td className="px-4 py-3 font-mono text-gray-300">{compactNumber(mover.volume)}</td>
                    <td className="py-3 pl-4 font-mono text-gray-300">{mover.value ? compactNumber(mover.value) : '—'}</td>
                  </tr>
                );
              }) : (
                <tr><td className="py-6 font-mono text-xs text-gray-500" colSpan={6}>{isFetching ? 'LOADING…' : 'NO DATA'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {asOfLabel ? (
          <p className="mt-4 font-mono text-[10px] uppercase tracking-wider text-gray-500">
            {range === '1d' ? `AS OF ${asOfLabel} · LAST OPERATING DAY` : `RANGE ${RANGE_LABEL[range]} · ENDING ${asOfLabel}`}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function MarketDashboard() {
  const [scope, setScope] = useState<MarketScope>('all');
  const marketStatusQuery = useMarketStatus();
  const isMarketOpen = marketStatusQuery.data?.isOpen ?? false;
  const { data, error, isLoading } = useQuery({
    queryKey: ['market-overview', scope],
    queryFn: () => fetchMarketOverview(scope),
    refetchInterval: isMarketOpen ? 30_000 : false,
    refetchOnWindowFocus: isMarketOpen,
  });
  const { data: sectorData, error: sectorError, isLoading: isSectorLoading } = useQuery({
    queryKey: ['sector-stats'],
    queryFn: fetchSectorStats,
    refetchInterval: isMarketOpen ? 15_000 : false,
    refetchOnWindowFocus: isMarketOpen,
  });

  const stats = data?.stats;
  const updatedAt = data ? new Date(data.updatedAt).toLocaleTimeString() : null;
  const asOfLabel = formatAsOfDate(data?.asOfTimestamp);
  const scopeLabel = scope === 'kse100' ? 'KSE-100' : 'ALL MARKET';

  return (
    <main className="min-h-[calc(100vh-120px)] px-4 py-8 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-10">
        <header className="flex flex-col gap-4 border-b border-line pb-6">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] text-coral tracking-widest">000 // MAIN TERMINAL</span>
            <span className="flex-1 h-px bg-coral/20" />
          </div>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="font-display text-5xl tracking-wide text-white lg:text-7xl">PSX TERMINAL</h1>
              <p className="mt-3 max-w-2xl font-mono text-xs leading-relaxed text-gray-500 uppercase tracking-wider">
                // PAKISTAN STOCK EXCHANGE · LIVE BREADTH, MOVERS, AND TURNOVER
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <select value={scope} onChange={(e) => setScope(e.target.value as MarketScope)}
                className="h-10 border border-line bg-black/30 px-3 font-mono text-xs uppercase text-white outline-none focus:border-coral">
                <option value="all">ALL MARKET</option>
                <option value="kse100">KSE-100</option>
              </select>
              <div className="border border-coral/30 bg-coral/5 px-3 py-2 font-mono text-[11px] uppercase text-gray-300">
                {updatedAt ? `UPDATED ${updatedAt}` : 'CONNECTING…'}
              </div>
            </div>
          </div>
        </header>

        <HeroBlock asOfLabel={asOfLabel} />

        {error ? (
          <div className="border border-rose-400/30 bg-rose-400/10 p-5 font-mono text-xs text-rose-100">
            {error instanceof Error ? error.message : 'Unable to load market data'}
          </div>
        ) : null}

        <section>
          <SectionTag code="001" label="MARKET PULSE" />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Total Volume" value={stats ? compactNumber(stats.totalVolume) : isLoading ? '--' : '--'} detail={stats ? `${stats.symbolCount} active` : scopeLabel} />
            <StatTile label="Total Value" value={stats ? money(stats.totalValue) : '--'} detail="Traded value" />
            <StatTile label="Total Trades" value={stats ? compactNumber(stats.totalTrades) : '--'} detail={stats ? `${data?.symbolsCount ?? stats.symbolCount} symbols` : 'Order flow'} />
            <StatTile label="Breadth" value={stats ? `${stats.gainers}/${stats.losers}` : '--'} detail={stats ? `${stats.unchanged} unchanged` : 'Adv/Dec'} accent="text-coral" />
          </div>
        </section>

        <section>
          <SectionTag code="002" label="MARKET OVERVIEW & MOVERS" />
          <div className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
            <div className="border border-line bg-panel p-5">
              <h3 className="font-display text-xl text-white tracking-wide">BREADTH</h3>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <div className="border border-line bg-black/20 p-4"><p className="font-mono text-[10px] uppercase text-gray-500">Gainers</p><p className="mt-3 font-display text-4xl text-emerald-300">{stats?.gainers ?? '--'}</p></div>
                <div className="border border-line bg-black/20 p-4"><p className="font-mono text-[10px] uppercase text-gray-500">Losers</p><p className="mt-3 font-display text-4xl text-rose-300">{stats?.losers ?? '--'}</p></div>
                <div className="border border-line bg-black/20 p-4"><p className="font-mono text-[10px] uppercase text-gray-500">Unchanged</p><p className="mt-3 font-display text-4xl text-gray-300">{stats?.unchanged ?? '--'}</p></div>
              </div>
              <div className="mt-5 border border-dashed border-coral/20 bg-black/20 p-4">
                <p className="font-mono text-[11px] uppercase text-gray-300">{scopeLabel} SUMMARY</p>
                <p className="mt-2 font-mono text-[11px] text-gray-500">Showing {scopeLabel.toLowerCase()} data from the PSX API and refreshing automatically.</p>
              </div>
            </div>
            <aside className="border border-line bg-panel p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-xl text-white tracking-wide">TOP MOVERS</h3>
              </div>
              {asOfLabel ? <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-coral">AS OF {asOfLabel}</p> : null}
              <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-gray-500">LAST OPERATING DAY</p>
              <div className="mt-4">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-emerald-300">▲ GAINERS</p>
                <div className="mt-2">
                  {stats?.topGainers.slice(0, 3).map((mover) => <MoverRow key={`gainer-${mover.symbol}`} mover={mover} tone="up" />) ?? <p className="py-3 font-mono text-xs text-gray-500">LOADING…</p>}
                </div>
              </div>
              <div className="mt-5">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-rose-300">▼ LOSERS</p>
                <div className="mt-2">
                  {stats?.topLosers.slice(0, 3).map((mover) => <MoverRow key={`loser-${mover.symbol}`} mover={mover} tone="down" />) ?? <p className="py-3 font-mono text-xs text-gray-500">LOADING…</p>}
                </div>
              </div>
            </aside>
          </div>
        </section>

        <SectorHeatmap sectors={sectorData?.sectors} isLoading={isSectorLoading} error={sectorError} isMarketOpen={isMarketOpen} />

        <LiveSymbolsTable asOfLabel={asOfLabel} fallbackStats={stats} scope={scope} />
      </div>
    </main>
  );
}
