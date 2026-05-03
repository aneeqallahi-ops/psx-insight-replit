import { getPortfolioKey } from './portfolio';

export const ALL_CATEGORIES = [
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
] as const;
export type NotificationCategory = (typeof ALL_CATEGORIES)[number];

export interface NotificationItem {
  id: number;
  announcementId: number;
  symbol: string;
  category: NotificationCategory;
  title: string;
  announcementDate: string | null;
  payload: Record<string, unknown> | null;
  emailSent: boolean;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationListResponse {
  items: NotificationItem[];
  unreadCount: number;
  updatedAt: number;
}

export interface NotificationPreferences {
  categories: NotificationCategory[];
  email: string | null;
  emailEnabled: boolean;
  inAppEnabled: boolean;
}

function authHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'X-Portfolio-Key': getPortfolioKey(),
  };
}

export async function fetchNotifications(opts: { limit?: number; unreadOnly?: boolean } = {}): Promise<NotificationListResponse> {
  const qs = new URLSearchParams();
  if (opts.limit) qs.set('limit', String(opts.limit));
  if (opts.unreadOnly) qs.set('unread', 'true');
  const res = await fetch(`/api/notifications${qs.toString() ? '?' + qs.toString() : ''}`, {
    headers: { 'X-Portfolio-Key': getPortfolioKey() },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('Unable to load notifications');
  return res.json();
}

export async function markNotificationsRead(input: { ids?: number[]; all?: boolean }): Promise<void> {
  const res = await fetch('/api/notifications/mark-read', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Unable to mark as read');
}

export async function fetchNotificationPreferences(): Promise<NotificationPreferences> {
  const res = await fetch('/api/notifications/preferences', {
    headers: { 'X-Portfolio-Key': getPortfolioKey() },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('Unable to load preferences');
  const data = (await res.json()) as { preferences: NotificationPreferences };
  return data.preferences;
}

export async function saveNotificationPreferences(prefs: NotificationPreferences): Promise<void> {
  const res = await fetch('/api/notifications/preferences', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(prefs),
  });
  if (!res.ok) throw new Error('Unable to save preferences');
}

export async function pollNotificationsNow(): Promise<void> {
  await fetch('/api/notifications/poll-now', {
    method: 'POST',
    headers: authHeaders(),
  });
}
