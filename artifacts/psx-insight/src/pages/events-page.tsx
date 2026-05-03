import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useSearch } from 'wouter';
import { Calendar, Coins, FileText, Gift, Megaphone, Scale, Users } from 'lucide-react';
import {
  AnnouncementDetailModal,
  CategoryBadge,
  fmtAnnouncementNumber,
  formatAnnouncementDate,
  type Announcement,
  type AnnouncementCategory,
  type AnnouncementsApiResponse,
} from '@/components/announcements';

const CATEGORIES: { value: '' | AnnouncementCategory; label: string; Icon: typeof Coins }[] = [
  { value: '', label: 'ALL', Icon: Megaphone },
  { value: 'DIVIDEND', label: 'DIVIDEND', Icon: Coins },
  { value: 'BONUS', label: 'BONUS', Icon: Gift },
  { value: 'RIGHT_ISSUE', label: 'RIGHT', Icon: Scale },
  { value: 'AGM', label: 'AGM', Icon: Users },
  { value: 'EOGM', label: 'EOGM', Icon: Users },
  { value: 'BOARD_MEETING', label: 'BOARD', Icon: Users },
  { value: 'CORPORATE_BRIEFING', label: 'BRIEFING', Icon: Megaphone },
  { value: 'BOOK_CLOSURE', label: 'BOOK CLOSURE', Icon: Calendar },
  { value: 'FINANCIAL_RESULT', label: 'RESULTS', Icon: FileText },
  { value: 'NOTICE', label: 'NOTICE', Icon: FileText },
];

type FetchParams = {
  symbol: string;
  category: '' | AnnouncementCategory;
  page: number;
  from: string;
  to: string;
  upcoming: boolean;
};

async function fetchAnnouncements(params: FetchParams): Promise<AnnouncementsApiResponse> {
  const qs = new URLSearchParams();
  if (params.symbol) qs.set('symbol', params.symbol);
  if (params.category) qs.set('category', params.category);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.upcoming) qs.set('upcoming', '1');
  if (params.page > 1) qs.set('page', String(params.page));
  const res = await fetch(`/api/announcements${qs.toString() ? '?' + qs.toString() : ''}`, { cache: 'no-store' });
  if (!res.ok) {
    const p = await res.json().catch(() => null);
    throw new Error(p?.error || 'Unable to load announcements');
  }
  return res.json();
}

function EventRow({ item, onOpen }: { item: Announcement; onOpen: (a: Announcement) => void }) {
  const dividend = fmtAnnouncementNumber(item.dividend);
  const bonus = fmtAnnouncementNumber(item.bonus);
  const right = fmtAnnouncementNumber(item.right_issue);
  const summaryBits: string[] = [];
  if (dividend) summaryBits.push(`Cash ${dividend}%`);
  if (bonus) summaryBits.push(`Bonus ${bonus}%`);
  if (right) summaryBits.push(`Right ${right}%`);
  if (item.ex_date) summaryBits.push(`Ex ${formatAnnouncementDate(item.ex_date)}`);
  if (item.book_closure_date_from) summaryBits.push(`Book ${formatAnnouncementDate(item.book_closure_date_from)}`);
  if (item.held_date) summaryBits.push(`Held ${formatAnnouncementDate(item.held_date)}`);

  return (
    <button type="button" onClick={() => onOpen(item)}
      className="w-full text-left border border-line bg-panel p-4 transition hover:border-coral/60 hover:bg-coral/5">
      <div className="flex flex-wrap items-center gap-2">
        <CategoryBadge category={item.category} />
        <span className="font-mono text-sm font-semibold text-white">{item.symbol}</span>
        <span className="font-mono text-[11px] text-gray-500">· {formatAnnouncementDate(item.date)}</span>
      </div>
      <p className="mt-2 font-mono text-sm text-gray-100 leading-snug">{item.title}</p>
      {summaryBits.length > 0 ? (
        <p className="mt-2 font-mono text-[11px] text-coral/80">{summaryBits.join(' · ')}</p>
      ) : null}
    </button>
  );
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

type Preset = 'TODAY' | '7D' | '30D' | 'UPCOMING';

export function EventsPage() {
  const search = useSearch();
  const initialSymbol = useMemo(() => new URLSearchParams(search).get('symbol')?.toUpperCase() ?? '', [search]);
  const [symbol, setSymbol] = useState(initialSymbol);
  const [symbolDraft, setSymbolDraft] = useState(initialSymbol);
  const [category, setCategory] = useState<'' | AnnouncementCategory>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [upcoming, setUpcoming] = useState(false);
  const [activePreset, setActivePreset] = useState<Preset | null>(null);
  const [page, setPage] = useState(1);
  const [openItem, setOpenItem] = useState<Announcement | null>(null);

  useEffect(() => {
    setSymbol(initialSymbol);
    setSymbolDraft(initialSymbol);
    setPage(1);
  }, [initialSymbol]);

  const applyPreset = (preset: Preset) => {
    setActivePreset(preset);
    setPage(1);
    if (preset === 'TODAY') {
      const t = todayISO();
      setFrom(t); setTo(t); setUpcoming(false);
    } else if (preset === '7D') {
      setFrom(isoDaysAgo(7)); setTo(todayISO()); setUpcoming(false);
    } else if (preset === '30D') {
      setFrom(isoDaysAgo(30)); setTo(todayISO()); setUpcoming(false);
    } else if (preset === 'UPCOMING') {
      setFrom(''); setTo(''); setUpcoming(true);
    }
  };

  const clearDates = () => {
    setFrom(''); setTo(''); setUpcoming(false); setActivePreset(null); setPage(1);
  };

  const onFromChange = (v: string) => { setFrom(v); setActivePreset(null); setUpcoming(false); setPage(1); };
  const onToChange = (v: string) => { setTo(v); setActivePreset(null); setUpcoming(false); setPage(1); };

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['announcements', symbol, category, from, to, upcoming, page],
    queryFn: () => fetchAnnouncements({ symbol, category, from, to, upcoming, page }),
    refetchInterval: 5 * 60_000,
  });

  const items = useMemo(() => data?.items ?? [], [data]);
  const dateActive = Boolean(from || to || upcoming);

  const presetChips: { key: Preset; label: string }[] = [
    { key: 'TODAY', label: 'TODAY' },
    { key: '7D', label: 'LAST 7D' },
    { key: '30D', label: 'LAST 30D' },
    { key: 'UPCOMING', label: 'UPCOMING' },
  ];

  return (
    <main className="min-h-[calc(100vh-120px)] px-4 py-8 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <header className="flex flex-col gap-4 border-b border-line pb-6">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] text-coral tracking-widest">007 // CORPORATE EVENTS</span>
            <span className="flex-1 h-px bg-coral/20" />
          </div>
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-5xl tracking-wide text-white lg:text-7xl">EVENTS</h1>
            <p className="font-mono text-xs uppercase tracking-wider text-gray-500">
              // DIVIDENDS · BOOK CLOSURES · BOARD MEETINGS · AGM/EOGM · CORPORATE BRIEFINGS · RESULTS
            </p>
          </div>
        </header>

        <section className="border border-line bg-panel p-5">
          <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
            <form
              onSubmit={(e) => { e.preventDefault(); setSymbol(symbolDraft.trim().toUpperCase()); setPage(1); }}
              className="flex flex-wrap items-end gap-3"
            >
              <div className="flex-1 min-w-[200px]">
                <label className="block font-mono text-[10px] uppercase text-gray-500 mb-1">SYMBOL FILTER</label>
                <input value={symbolDraft} onChange={(e) => setSymbolDraft(e.target.value)} placeholder="e.g. HBL"
                  className="w-full h-10 border border-line bg-black/30 px-3 font-mono text-sm uppercase text-white outline-none focus:border-coral" />
              </div>
              <button type="submit" className="h-10 border border-coral bg-coral/15 px-4 font-mono text-xs uppercase tracking-wider text-coral transition hover:bg-coral/25">
                APPLY
              </button>
              {symbol ? (
                <button type="button" onClick={() => { setSymbolDraft(''); setSymbol(''); setPage(1); }}
                  className="h-10 border border-line px-4 font-mono text-xs uppercase tracking-wider text-gray-300 transition hover:border-coral hover:text-coral">
                  CLEAR
                </button>
              ) : null}
            </form>
            <div className="font-mono text-[11px] text-gray-500">
              {data?.pagination
                ? data.pagination.filtered
                  ? `${data.pagination.total} MATCHES IN LAST ${data.pagination.sweptPages ?? 5} PAGES · PAGE ${data.pagination.page}/${data.pagination.totalPages}`
                  : `${data.pagination.total} TOTAL · PAGE ${data.pagination.page}/${data.pagination.totalPages}`
                : isLoading ? 'LOADING…' : ''}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line/60 pt-4">
            <div>
              <label className="block font-mono text-[10px] uppercase text-gray-500 mb-1">FROM DATE</label>
              <input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => onFromChange(e.target.value)}
                aria-label="From date"
                className="h-10 border border-line bg-black/30 px-3 font-mono text-xs uppercase text-white outline-none focus:border-coral"
              />
            </div>
            <div>
              <label className="block font-mono text-[10px] uppercase text-gray-500 mb-1">TO DATE</label>
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => onToChange(e.target.value)}
                aria-label="To date"
                className="h-10 border border-line bg-black/30 px-3 font-mono text-xs uppercase text-white outline-none focus:border-coral"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {presetChips.map(({ key, label }) => {
                const active = activePreset === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => applyPreset(key)}
                    className={`h-10 inline-flex items-center gap-1.5 border px-3 font-mono text-[10px] uppercase tracking-wider transition ${
                      active ? 'border-coral bg-coral/15 text-coral' : 'border-line text-gray-400 hover:border-coral/50 hover:text-white'
                    }`}
                  >
                    <Calendar className="h-3 w-3" /> {label}
                  </button>
                );
              })}
              {dateActive ? (
                <button
                  type="button"
                  onClick={clearDates}
                  className="h-10 border border-line px-3 font-mono text-[10px] uppercase tracking-wider text-gray-300 transition hover:border-coral hover:text-coral"
                >
                  CLEAR DATES
                </button>
              ) : null}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {CATEGORIES.map(({ value, label, Icon }) => {
              const active = category === value;
              return (
                <button key={value || 'ALL'} type="button" onClick={() => { setCategory(value); setPage(1); }}
                  className={`inline-flex items-center gap-1.5 border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition ${
                    active ? 'border-coral bg-coral/15 text-coral' : 'border-line text-gray-400 hover:border-coral/50 hover:text-white'
                  }`}>
                  <Icon className="h-3 w-3" /> {label}
                </button>
              );
            })}
          </div>
        </section>

        {error ? (
          <div className="border border-rose-400/30 bg-rose-400/10 p-4 font-mono text-xs text-rose-100">
            {error instanceof Error ? error.message : 'Unable to load announcements'}
          </div>
        ) : null}

        <section className="grid gap-3">
          {isLoading && items.length === 0 ? (
            <p className="font-mono text-xs text-gray-500">LOADING EVENTS…</p>
          ) : items.length === 0 ? (
            <p className="font-mono text-xs text-gray-500">No matching announcements.</p>
          ) : (
            items.map((it) => <EventRow key={it.id} item={it} onOpen={setOpenItem} />)
          )}
        </section>

        {data?.pagination ? (
          <div className="flex items-center justify-between border-t border-line pt-4">
            <button type="button" disabled={!data.pagination.hasPrev || isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="border border-line px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-gray-300 transition hover:border-coral hover:text-coral disabled:opacity-30 disabled:cursor-not-allowed">
              ← PREV
            </button>
            <span className="font-mono text-[11px] uppercase text-gray-500">
              PAGE {data.pagination.page} / {data.pagination.totalPages}
            </span>
            <button type="button" disabled={!data.pagination.hasNext || isFetching} onClick={() => setPage((p) => p + 1)}
              className="border border-line px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-gray-300 transition hover:border-coral hover:text-coral disabled:opacity-30 disabled:cursor-not-allowed">
              NEXT →
            </button>
          </div>
        ) : null}

        {openItem ? <AnnouncementDetailModal item={openItem} onClose={() => setOpenItem(null)} /> : null}
      </div>
    </main>
  );
}
