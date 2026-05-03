import type { Announcement } from './types';

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

export const ALL_CATEGORIES: AnnouncementCategory[] = [
  'DIVIDEND',
  'BONUS',
  'RIGHT_ISSUE',
  'AGM',
  'EOGM',
  'BOARD_MEETING',
  'CORPORATE_BRIEFING',
  'BOOK_CLOSURE',
  'FINANCIAL_RESULT',
  'NOTICE',
];

function isPositive(v: number | string | null | undefined): boolean {
  if (v == null || v === '') return false;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0;
}

export function classifyAnnouncement(a: Announcement): AnnouncementCategory {
  const t = (a.title || '').toLowerCase();
  if (isPositive(a.dividend) || isPositive(a.specie_dividend)) return 'DIVIDEND';
  if (isPositive(a.bonus)) return 'BONUS';
  if (isPositive(a.right_issue)) return 'RIGHT_ISSUE';
  if (a.book_closure_date_from || a.book_closure_date_to) return 'BOOK_CLOSURE';
  if (/extraordinary general meeting|eogm/.test(t)) return 'EOGM';
  if (/annual general meeting|\bagm\b/.test(t)) return 'AGM';
  if (/board meeting/.test(t)) return 'BOARD_MEETING';
  if (/corporate briefing/.test(t)) return 'CORPORATE_BRIEFING';
  if (/dividend|cash payout|interim payout/.test(t)) return 'DIVIDEND';
  if (/bonus shares|bonus issue/.test(t)) return 'BONUS';
  if (/right shares|right issue/.test(t)) return 'RIGHT_ISSUE';
  if (isPositive(a.stock_split) || isPositive(a.reverse_split) || /stock split|reverse split/.test(t)) return 'NOTICE';
  if (a.period_end_date || /quarterly|half year|annual report|financial statement/.test(t)) return 'FINANCIAL_RESULT';
  return 'NOTICE';
}

const SAFE_HOST_SUFFIXES = ['psx.com.pk', 'psxterminal.com'];

export function sanitizeAnnouncementLink(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase();
    if (!SAFE_HOST_SUFFIXES.some((s) => host === s || host.endsWith('.' + s))) return null;
    return u.toString();
  } catch {
    return null;
  }
}
