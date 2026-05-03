import { useEffect } from 'react';
import { Link } from 'wouter';
import { FileText, X } from 'lucide-react';

export type AnnouncementCategory =
  | 'DIVIDEND'
  | 'BONUS'
  | 'RIGHT_ISSUE'
  | 'AGM'
  | 'EOGM'
  | 'BOARD_MEETING'
  | 'CORPORATE_BRIEFING'
  | 'BOOK_CLOSURE'
  | 'FINANCIAL_RESULT'
  | 'NOTICE';

export interface Announcement {
  id: number;
  symbol: string;
  announcement_type: string;
  title: string;
  date: string;
  created_at: string;
  updated_at: string;
  content?: string | null;
  agenda?: string | null;
  pdf_id?: string | null;
  image_link?: string | null;
  dividend?: number | string | null;
  specie_dividend?: number | string | null;
  bonus?: number | string | null;
  right_issue?: number | string | null;
  right_price?: number | string | null;
  book_closure_date_from?: string | null;
  book_closure_date_to?: string | null;
  ex_date?: string | null;
  entitlement_paid_date?: string | null;
  held_date?: string | null;
  period_end_date?: string | null;
  unconsolidated_eps?: number | string | null;
  consolidated_eps?: number | string | null;
  growth_in_pat?: number | string | null;
  quarter?: string | null;
  category: AnnouncementCategory;
}

export interface AnnouncementsApiResponse {
  symbol: string | null;
  page: number;
  limit: number;
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
    filtered?: boolean;
    sweptPages?: number;
    upstreamTotal?: number | null;
  } | null;
  items: Announcement[];
  updatedAt: number;
}

export const CATEGORY_TONE: Record<AnnouncementCategory, string> = {
  DIVIDEND: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
  BONUS: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
  RIGHT_ISSUE: 'border-violet-400/40 bg-violet-400/10 text-violet-300',
  AGM: 'border-sky-400/40 bg-sky-400/10 text-sky-300',
  EOGM: 'border-sky-400/40 bg-sky-400/10 text-sky-300',
  BOARD_MEETING: 'border-cyan-400/40 bg-cyan-400/10 text-cyan-200',
  CORPORATE_BRIEFING: 'border-coral/40 bg-coral/10 text-coral',
  BOOK_CLOSURE: 'border-indigo-400/40 bg-indigo-400/10 text-indigo-300',
  FINANCIAL_RESULT: 'border-line bg-black/40 text-gray-300',
  NOTICE: 'border-line bg-black/30 text-gray-400',
};

export function formatAnnouncementDate(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi',
  }).format(d).toUpperCase();
}

export function formatAnnouncementDateTime(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Karachi',
  }).format(d).toUpperCase();
}

export function fmtAnnouncementNumber(v: number | string | null | undefined): string | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

export function isFutureDate(s: string | null | undefined): boolean {
  if (!s) return false;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return d.getTime() >= today.getTime();
}

export function CategoryBadge({ category }: { category: AnnouncementCategory }) {
  return (
    <span className={`inline-flex items-center border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${CATEGORY_TONE[category]}`}>
      {category.replace(/_/g, ' ')}
    </span>
  );
}

export function AnnouncementDetailModal({
  item,
  onClose,
  showSymbolLink = true,
}: {
  item: Announcement;
  onClose: () => void;
  showSymbolLink?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const facts: { label: string; value: string }[] = [];
  const dividend = fmtAnnouncementNumber(item.dividend);
  if (dividend) facts.push({ label: 'CASH DIVIDEND', value: `${dividend}%` });
  const specie = fmtAnnouncementNumber(item.specie_dividend);
  if (specie) facts.push({ label: 'SPECIE DIVIDEND', value: specie });
  const bonus = fmtAnnouncementNumber(item.bonus);
  if (bonus) facts.push({ label: 'BONUS', value: `${bonus}%` });
  const right = fmtAnnouncementNumber(item.right_issue);
  if (right) facts.push({ label: 'RIGHT ISSUE', value: `${right}%` });
  const rightPrice = fmtAnnouncementNumber(item.right_price);
  if (rightPrice) facts.push({ label: 'RIGHT PRICE', value: rightPrice });
  if (item.ex_date) facts.push({ label: 'EX DATE', value: formatAnnouncementDate(item.ex_date) });
  if (item.entitlement_paid_date) facts.push({ label: 'PAYMENT DATE', value: formatAnnouncementDate(item.entitlement_paid_date) });
  if (item.book_closure_date_from || item.book_closure_date_to) {
    facts.push({ label: 'BOOK CLOSURE', value: `${formatAnnouncementDate(item.book_closure_date_from)} → ${formatAnnouncementDate(item.book_closure_date_to)}` });
  }
  if (item.held_date) facts.push({ label: 'MEETING HELD', value: formatAnnouncementDateTime(item.held_date) });
  if (item.period_end_date) facts.push({ label: 'PERIOD END', value: formatAnnouncementDate(item.period_end_date) });
  if (item.quarter) facts.push({ label: 'QUARTER', value: item.quarter });
  const eps = fmtAnnouncementNumber(item.unconsolidated_eps ?? item.consolidated_eps);
  if (eps) facts.push({ label: 'EPS', value: eps });
  const growth = fmtAnnouncementNumber(item.growth_in_pat);
  if (growth) facts.push({ label: 'PAT GROWTH', value: `${growth}%` });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6" role="dialog" aria-modal="true" aria-label={item.title}>
      <button type="button" aria-label="Close detail" className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-3xl max-h-[85vh] overflow-y-auto border border-coral/40 bg-panel p-6 clip-notch shadow-2xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between border-b border-line pb-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <CategoryBadge category={item.category} />
              {showSymbolLink ? (
                <Link href={`/stock?symbol=${encodeURIComponent(item.symbol)}`} className="font-mono text-sm font-semibold text-white hover:text-coral" onClick={onClose}>
                  {item.symbol}
                </Link>
              ) : (
                <span className="font-mono text-sm font-semibold text-white">{item.symbol}</span>
              )}
              <span className="font-mono text-[11px] text-gray-500">· {formatAnnouncementDateTime(item.date)}</span>
            </div>
            <h3 className="mt-2 font-display text-xl text-white tracking-wide leading-tight">{item.title}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="self-start border border-line p-2 text-gray-300 transition hover:border-coral hover:text-coral">
            <X className="h-4 w-4" />
          </button>
        </div>
        {facts.length > 0 ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {facts.map((f) => (
              <div key={f.label} className="border border-line bg-black/30 px-3 py-2">
                <p className="font-mono text-[10px] uppercase text-gray-500">{f.label}</p>
                <p className="mt-1 font-mono text-sm text-white">{f.value}</p>
              </div>
            ))}
          </div>
        ) : null}
        {item.agenda ? (
          <div className="mt-4">
            <p className="font-mono text-[10px] uppercase text-gray-500 mb-1">AGENDA</p>
            <p className="font-mono text-xs text-gray-200 whitespace-pre-wrap leading-relaxed">{item.agenda}</p>
          </div>
        ) : null}
        {item.content && item.content !== item.title ? (
          <div className="mt-4">
            <p className="font-mono text-[10px] uppercase text-gray-500 mb-1">SUMMARY</p>
            <p className="font-mono text-xs text-gray-200 whitespace-pre-wrap leading-relaxed">{item.content}</p>
          </div>
        ) : null}
        {item.pdf_id ? (
          <div className="mt-5 flex flex-wrap gap-3">
            <a href={item.pdf_id} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-2 border border-coral bg-coral/15 px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-coral transition hover:bg-coral/25">
              <FileText className="h-4 w-4" /> Open PDF
            </a>
            {item.image_link ? (
              <a href={item.image_link} target="_blank" rel="noopener noreferrer"
                 className="inline-flex items-center gap-2 border border-line px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-gray-300 transition hover:border-coral hover:text-coral">
                Open Image
              </a>
            ) : null}
          </div>
        ) : null}
        <p className="mt-5 font-mono text-[10px] uppercase text-gray-600">SOURCE: PSX TERMINAL · TYPE {item.announcement_type}</p>
      </div>
    </div>
  );
}
