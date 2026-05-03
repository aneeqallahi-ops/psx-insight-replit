import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import {
  AnnouncementDetailModal,
  CategoryBadge,
  fmtAnnouncementNumber,
  formatAnnouncementDate,
  isFutureDate,
  type Announcement,
  type AnnouncementsApiResponse,
} from './announcements';

async function fetchSymbolAnnouncements(symbol: string): Promise<AnnouncementsApiResponse> {
  const res = await fetch(`/api/announcements?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' });
  if (!res.ok) {
    const p = await res.json().catch(() => null);
    throw new Error(p?.error || 'Unable to load corporate calendar');
  }
  return res.json();
}

interface CalendarEntry {
  date: string;
  label: string;
  ann: Announcement;
}

function gatherUpcoming(items: Announcement[]): CalendarEntry[] {
  const out: CalendarEntry[] = [];
  for (const a of items) {
    if (isFutureDate(a.ex_date)) out.push({ date: a.ex_date as string, label: 'EX DATE', ann: a });
    if (isFutureDate(a.entitlement_paid_date)) out.push({ date: a.entitlement_paid_date as string, label: 'PAYMENT', ann: a });
    if (isFutureDate(a.book_closure_date_from)) out.push({ date: a.book_closure_date_from as string, label: 'BOOK CLOSURE', ann: a });
    if (isFutureDate(a.held_date)) out.push({ date: a.held_date as string, label: 'MEETING', ann: a });
    if (isFutureDate(a.period_end_date)) out.push({ date: a.period_end_date as string, label: 'PERIOD END', ann: a });
  }
  return out.sort((x, y) => x.date.localeCompare(y.date)).slice(0, 6);
}

function summary(ann: Announcement): string {
  const parts: string[] = [];
  const div = fmtAnnouncementNumber(ann.dividend);
  if (div) parts.push(`Cash ${div}%`);
  const bonus = fmtAnnouncementNumber(ann.bonus);
  if (bonus) parts.push(`Bonus ${bonus}%`);
  const right = fmtAnnouncementNumber(ann.right_issue);
  if (right) parts.push(`Right ${right}%`);
  if (ann.ex_date) parts.push(`Ex ${formatAnnouncementDate(ann.ex_date)}`);
  if (ann.book_closure_date_from) parts.push(`Book ${formatAnnouncementDate(ann.book_closure_date_from)}`);
  if (ann.held_date) parts.push(`Held ${formatAnnouncementDate(ann.held_date)}`);
  return parts.join(' · ');
}

export function CorporateCalendar({ symbol }: { symbol: string }) {
  const [openItem, setOpenItem] = useState<Announcement | null>(null);
  const [, navigate] = useLocation();
  const { data, isLoading, error } = useQuery({
    queryKey: ['stock-announcements', symbol],
    queryFn: () => fetchSymbolAnnouncements(symbol),
    enabled: Boolean(symbol),
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const items = useMemo(() => (data?.items ?? []).slice(0, 10), [data]);
  const upcoming = useMemo(() => gatherUpcoming(data?.items ?? []), [data]);

  return (
    <section className="rounded border border-line bg-panel p-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between border-b border-line pb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Corporate Calendar</h2>
          <p className="mt-1 text-sm text-gray-500">Latest announcements for {symbol} from PSX Terminal</p>
        </div>
        <button type="button" onClick={() => navigate(`/events?symbol=${encodeURIComponent(symbol)}`)}
          className="self-start sm:self-auto rounded border border-coral/40 bg-coral/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-coral transition hover:bg-coral/20">
          View all in Events →
        </button>
      </div>

      {error ? (
        <p className="mt-4 font-mono text-xs text-rose-200">
          {error instanceof Error ? error.message : 'Unable to load corporate calendar'}
        </p>
      ) : null}

      {upcoming.length > 0 ? (
        <div className="mt-5">
          <p className="font-mono text-[10px] uppercase tracking-wider text-coral mb-2">UPCOMING</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((u, i) => (
              <button key={`${u.ann.id}-${u.label}-${i}`} type="button" onClick={() => setOpenItem(u.ann)}
                className="text-left border border-coral/40 bg-coral/5 p-3 transition hover:border-coral hover:bg-coral/10">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-coral">{u.label}</span>
                  <span className="font-mono text-[11px] text-white">{formatAnnouncementDate(u.date)}</span>
                </div>
                <p className="mt-1.5 font-mono text-xs text-gray-100 leading-snug line-clamp-2">{u.ann.title}</p>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-5">
        <p className="font-mono text-[10px] uppercase tracking-wider text-gray-500 mb-2">RECENT ANNOUNCEMENTS</p>
        {isLoading && items.length === 0 ? (
          <p className="font-mono text-xs text-gray-500">LOADING…</p>
        ) : items.length === 0 ? (
          <p className="font-mono text-xs text-gray-500">No announcements available for this symbol.</p>
        ) : (
          <div className="grid gap-2">
            {items.map((it) => {
              const sum = summary(it);
              return (
                <button key={it.id} type="button" onClick={() => setOpenItem(it)}
                  className="text-left border border-line bg-black/20 p-3 transition hover:border-coral/60 hover:bg-coral/5">
                  <div className="flex flex-wrap items-center gap-2">
                    <CategoryBadge category={it.category} />
                    <span className="font-mono text-[11px] text-gray-500">{formatAnnouncementDate(it.date)}</span>
                  </div>
                  <p className="mt-1.5 font-mono text-sm text-gray-100 leading-snug">{it.title}</p>
                  {sum ? <p className="mt-1.5 font-mono text-[11px] text-coral/80">{sum}</p> : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {openItem ? <AnnouncementDetailModal item={openItem} onClose={() => setOpenItem(null)} showSymbolLink={false} /> : null}
    </section>
  );
}
