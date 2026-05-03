import { Menu, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { ReactNode, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMarketStatus } from '@/hooks/useMarketStatus';
import type { MarketStats } from '@/lib/types';
import { NotificationBell } from './notification-bell';

const navigation = [
  { label: 'Dashboard', href: '/', code: '01' },
  { label: 'Markets', href: '/markets', code: '02' },
  { label: 'Portfolio', href: '/watchlist', code: '03' },
  { label: 'News', href: '/news', code: '04' },
  { label: 'Events', href: '/events', code: '05' },
  { label: 'Analysis', href: '/analysis', code: '06' },
];

interface MarketOverview {
  stats: MarketStats;
  asOfTimestamp?: string | null;
  updatedAt: number;
}

async function fetchOverview(): Promise<MarketOverview> {
  const res = await fetch('/api/market/overview?scope=all', { cache: 'no-store' });
  if (!res.ok) throw new Error('overview unavailable');
  return res.json();
}

function formatPktTime(ts: string | number | null | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Karachi',
  }).format(d);
}

function formatPktDate(ts: string | number | null | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Karachi',
  }).format(d).replace(/,/g, '').toUpperCase();
}

function TickerStrip() {
  const marketStatusQuery = useMarketStatus();
  const isMarketOpen = marketStatusQuery.data?.isOpen ?? false;
  const { data } = useQuery({
    queryKey: ['ticker-overview'],
    queryFn: fetchOverview,
    refetchInterval: isMarketOpen ? 30_000 : 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const stats = data?.stats;
  if (!stats) {
    return (
      <div className="border-y border-line bg-black/40 py-2 text-xs font-mono text-gray-500">
        <div className="px-6">LOADING TAPE…</div>
      </div>
    );
  }
  const movers = [...stats.topGainers.slice(0, 8), ...stats.topLosers.slice(0, 8)];
  const items = [...movers, ...movers];
  return (
    <div className="border-y border-line bg-black/40 py-2 overflow-hidden">
      <div className="animate-marquee text-xs font-mono">
        {items.map((m, i) => {
          const positive = m.change >= 0;
          return (
            <span key={`${m.symbol}-${i}`} className="mx-6 inline-flex items-center gap-2">
              <Link href={`/stock?symbol=${encodeURIComponent(m.symbol)}`} className="font-semibold text-gray-200 hover:text-coral">
                {m.symbol}
              </Link>
              <span className="text-gray-400">{m.price.toFixed(2)}</span>
              <span className={positive ? 'text-emerald-300' : 'text-rose-300'}>
                {positive ? '▲' : '▼'} {Math.abs(m.changePercent * 100).toFixed(2)}%
              </span>
              <span className="text-gray-700">|</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
  return (
    <nav className="flex flex-1 flex-col gap-0.5 lg:flex-row lg:items-center lg:gap-1">
      {navigation.map((item) => {
        const active = item.href === '/' ? location === '/' : location.startsWith(item.href);
        return (
          <Link
            key={item.code}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-2 px-3 py-2 text-xs font-mono uppercase tracking-wider transition border ${
              active
                ? 'border-coral/60 bg-coral/10 text-coral'
                : 'border-transparent text-gray-400 hover:border-coral/30 hover:text-coral'
            }`}
          >
            <span className="text-[10px] opacity-50">{item.code}</span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function StatusPill() {
  const marketStatusQuery = useMarketStatus();
  const isMarketOpen = marketStatusQuery.data?.isOpen ?? false;
  const label = marketStatusQuery.data?.label ?? 'CHECKING';
  const ts = marketStatusQuery.data?.timestamp;
  const time = formatPktTime(ts);
  const date = formatPktDate(ts);
  return (
    <div className={`flex items-center gap-2 border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider ${
      isMarketOpen
        ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
        : 'border-rose-400/40 bg-rose-400/10 text-rose-300'
    }`}>
      <span className={`h-1.5 w-1.5 rounded-full ${isMarketOpen ? 'bg-emerald-300 animate-pulse' : 'bg-rose-400'}`} />
      <span>{label.toUpperCase()}</span>
      {time && date ? (
        <span className="opacity-70">· AS OF {date} · {time} PKT</span>
      ) : null}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-canvas text-gray-100">
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/95 backdrop-blur">
        <div className="flex items-center gap-4 px-4 py-3 lg:px-6">
          <Link href="/" className="flex items-center gap-3 shrink-0">
            <div className="grid h-9 w-9 place-items-center border border-coral bg-coral text-canvas font-display text-lg leading-none">
              P
            </div>
            <div className="hidden sm:block leading-tight">
              <p className="font-display text-base text-white">PSX INSIGHT</p>
              <p className="text-[10px] font-mono uppercase text-gray-500 tracking-wider">Market Terminal</p>
            </div>
          </Link>

          <div className="hidden lg:flex flex-1 items-center justify-center">
            <NavList />
          </div>

          <div className="hidden lg:flex items-center gap-3 shrink-0">
            <NotificationBell />
            <StatusPill />
          </div>

          <div className="ml-auto flex items-center gap-2 lg:hidden">
            <NotificationBell />
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="border border-line p-2 text-gray-200"
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
        <TickerStrip />
      </header>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/80"
            onClick={() => setOpen(false)}
          />
          <aside className="relative h-full w-[280px] border-r border-line bg-panel p-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <p className="font-display text-base text-white">PSX INSIGHT</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="border border-line p-1.5 text-gray-200"
                aria-label="Close navigation"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-4">
              <NavList onNavigate={() => setOpen(false)} />
            </div>
            <div className="mt-4">
              <StatusPill />
            </div>
          </aside>
        </div>
      ) : null}

      <main>{children}</main>
    </div>
  );
}
