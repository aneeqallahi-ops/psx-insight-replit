import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { useMemo, useState } from 'react';
import { PortfolioStarButton } from '@/components/portfolio-star-button';
import { useMarketStatus } from '@/hooks/useMarketStatus';

interface MarketRow {
  symbol: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  value: number | null;
  sector: string;
  isKSE100?: boolean;
}

interface MarketsResponse {
  rows: MarketRow[];
  scope: MarketScope;
  updatedAt: number;
}

interface EnrichedData {
  price: number;
  changePercent: number;
}

interface EnrichResponse {
  enriched: Record<string, EnrichedData>;
  updatedAt: number;
}

type MarketScope = 'kse100' | 'all';
type SortKey = keyof MarketRow;

const pageSize = 50;

function compactNumber(value: number | null) {
  if (value === null) return '--';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
}

function formatNumber(value: number | null) {
  if (value === null) return '--';
  return value.toFixed(2);
}

function signedPercent(value: number | null) {
  if (value === null) return '--';
  const formatted = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, style: 'percent' }).format(value);
  return value > 0 ? `+${formatted}` : formatted;
}

async function fetchMarkets(scope: MarketScope): Promise<MarketsResponse> {
  const res = await fetch(`/api/markets?scope=${scope}`, { cache: 'no-store' });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new Error(payload?.error || 'Unable to load markets');
  }
  return res.json();
}

async function fetchEnrich(symbols: string[]): Promise<EnrichResponse> {
  const params = new URLSearchParams({ symbols: symbols.join(',') });
  const res = await fetch(`/api/markets/enrich?${params.toString()}`, { cache: 'no-store' });
  if (!res.ok) return { enriched: {}, updatedAt: Date.now() };
  return res.json();
}

function compareValues(a: MarketRow, b: MarketRow, key: SortKey) {
  const av = a[key];
  const bv = b[key];
  if (typeof av === 'number' || typeof bv === 'number') {
    const an = typeof av === 'number' ? av : Number.NEGATIVE_INFINITY;
    const bn = typeof bv === 'number' ? bv : Number.NEGATIVE_INFINITY;
    return an - bn;
  }
  return String(av ?? '').localeCompare(String(bv ?? ''));
}

export function MarketsPage() {
  const [, navigate] = useLocation();
  const marketStatusQuery = useMarketStatus();
  const isMarketOpen = marketStatusQuery.data?.isOpen ?? false;
  const [search, setSearch] = useState('');
  const [sector, setSector] = useState('All');
  const [scope, setScope] = useState<MarketScope>('kse100');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({ key: 'symbol', direction: 'asc' });

  const { data, error, isFetching, isLoading } = useQuery({
    queryKey: ['markets', scope],
    queryFn: () => fetchMarkets(scope),
    refetchInterval: isMarketOpen ? 60_000 : false,
    refetchOnWindowFocus: isMarketOpen,
  });

  const sectors = useMemo(() => ['All', ...Array.from(new Set((data?.rows ?? []).map((r) => r.sector))).sort()], [data?.rows]);
  const filteredRows = useMemo(() => {
    const query = search.trim().toUpperCase();
    return (data?.rows ?? [])
      .filter((r) => (query ? r.symbol.toUpperCase().includes(query) : true))
      .filter((r) => (sector === 'All' ? true : r.sector === sector))
      .sort((a, b) => {
        const v = compareValues(a, b, sort.key);
        return sort.direction === 'asc' ? v : -v;
      });
  }, [data?.rows, search, sector, sort]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const visibleRows = useMemo(() => filteredRows.slice((page - 1) * pageSize, page * pageSize), [filteredRows, page]);
  const visibleSymbols = useMemo(() => visibleRows.map((r) => r.symbol), [visibleRows]);

  const { data: enrichData, isFetching: isFetchingEnrich } = useQuery({
    queryKey: ['markets-enrich', visibleSymbols],
    queryFn: () => fetchEnrich(visibleSymbols),
    enabled: visibleSymbols.length > 0,
    refetchInterval: isMarketOpen ? 30_000 : false,
    refetchOnWindowFocus: isMarketOpen,
    staleTime: 60_000,
  });

  const enrichedVisibleRows = useMemo(() =>
    visibleRows.map((row) => {
      const enrich = enrichData?.enriched[row.symbol];
      if (!enrich) return row;
      return {
        ...row,
        price: row.price ?? enrich.price,
        changePercent: row.changePercent ?? enrich.changePercent,
      };
    }),
    [enrichData, visibleRows],
  );

  const scopeLabel = scope === 'kse100' ? 'KSE-100' : 'All Listed';

  function updateSort(key: SortKey) {
    setSort((c) => ({ key, direction: c.key === key && c.direction === 'asc' ? 'desc' : 'asc' }));
  }

  const statusText = (() => {
    if (marketStatusQuery.isFetching) return 'Checking status';
    if (isFetching || isFetchingEnrich) return 'Refreshing';
    const label = marketStatusQuery.data?.label ?? 'Loading';
    const ts = enrichData?.updatedAt ?? data?.updatedAt;
    return ts ? `${label} - Updated ${new Date(ts).toLocaleTimeString()}` : label;
  })();

  return (
    <main className="min-h-[calc(100vh-120px)] px-4 py-8 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-line pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-[10px] text-coral tracking-widest">002 // MARKETS</span>
            </div>
            <h1 className="mt-2 font-display text-4xl tracking-wide text-white lg:text-6xl">{scopeLabel} SYMBOLS</h1>
            <p className="mt-3 max-w-2xl font-mono text-xs uppercase tracking-wider leading-relaxed text-gray-500">// PSX API SOURCE · TOP MOVERS LIVE · OTHERS FROM LAST SNAPSHOT</p>
          </div>
          <div className={`rounded border px-4 py-2 text-sm font-medium ${isMarketOpen ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' : 'border-rose-400/30 bg-rose-400/10 text-rose-200'}`}>
            {statusText}
          </div>
        </header>

        {error ? (
          <div className="rounded border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-100">
            {error instanceof Error ? error.message : 'Unable to load markets'}
          </div>
        ) : null}

        <section className="rounded border border-line bg-panel p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search symbol"
              className="h-11 rounded border border-line bg-black/20 px-4 text-sm text-white outline-none placeholder:text-gray-600 focus:border-coral/60 lg:w-80"
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <select
                value={scope}
                onChange={(e) => { setScope(e.target.value as MarketScope); setSector('All'); setPage(1); }}
                className="h-11 rounded border border-line bg-black/20 px-4 text-sm text-white outline-none focus:border-coral/60"
              >
                <option value="kse100">KSE-100</option>
                <option value="all">All symbols</option>
              </select>
              <select
                value={sector}
                onChange={(e) => { setSector(e.target.value); setPage(1); }}
                className="h-11 rounded border border-line bg-black/20 px-4 text-sm text-white outline-none focus:border-coral/60"
              >
                {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase text-gray-500">
                  {[['symbol', 'Symbol'], ['price', 'Price'], ['change', 'Change'], ['changePercent', 'Change%'], ['volume', 'Volume'], ['value', 'Value'], ['sector', 'Sector']].map(([key, label]) => (
                    <th key={key} className="px-4 py-3 font-medium first:pl-0 last:pr-0">
                      <button type="button" onClick={() => updateSort(key as SortKey)} className="text-left hover:text-coral">{label}</button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {enrichedVisibleRows.length > 0 ? (
                  enrichedVisibleRows.map((row) => {
                    const positive = (row.changePercent ?? 0) >= 0;
                    const toneClass = positive ? 'text-emerald-300' : 'text-rose-300';
                    return (
                      <tr
                        key={row.symbol}
                        onClick={() => navigate(`/stock?symbol=${encodeURIComponent(row.symbol)}`)}
                        className="cursor-pointer border-b border-line/80 transition hover:bg-white/[0.04]"
                      >
                        <td className="py-3 pl-0 pr-4 font-medium text-white">
                          <div className="flex items-center gap-2">
                            <PortfolioStarButton symbol={row.symbol} currentPrice={row.price} compact />
                            <Link href={`/stock?symbol=${encodeURIComponent(row.symbol)}`} className="hover:underline">{row.symbol}</Link>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-300">{formatNumber(row.price)}</td>
                        <td className={`px-4 py-3 font-medium ${row.change === null ? 'text-gray-500' : toneClass}`}>{formatNumber(row.change)}</td>
                        <td className={`px-4 py-3 font-medium ${row.changePercent === null ? 'text-gray-500' : toneClass}`}>{signedPercent(row.changePercent)}</td>
                        <td className="px-4 py-3 text-gray-300">{compactNumber(row.volume)}</td>
                        <td className="px-4 py-3 text-gray-300">{compactNumber(row.value)}</td>
                        <td className="py-3 pl-4 pr-0 text-gray-400">{row.sector}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td className="py-6 text-gray-500" colSpan={7}>{isLoading ? 'Loading markets' : 'No symbols match the current filters.'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-5 flex items-center justify-between text-sm text-gray-400">
            <span>Page {page} of {pageCount} - {filteredRows.length} symbols</span>
            <div className="flex gap-2">
              <button type="button" disabled={page === 1} onClick={() => setPage((c) => Math.max(1, c - 1))} className="rounded border border-line px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
              <button type="button" disabled={page === pageCount} onClick={() => setPage((c) => Math.min(pageCount, c + 1))} className="rounded border border-line px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
