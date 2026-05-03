import { db } from '@workspace/db';
import {
  notificationCursors,
  notificationPreferences,
  notifications,
  portfolioHoldings,
} from '@workspace/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { logger } from '../logger';
import { PSXApi } from '../psx-api';
import {
  classifyAnnouncement,
  sanitizeAnnouncementLink,
  type AnnouncementCategory,
} from '../announcement-classifier';
import type { Announcement } from '../types';
import { sendAnnouncementEmail } from './email';

const TICK_MS = 15 * 60 * 1000; // 15 minutes
const SYMBOL_FETCH_CONCURRENCY = 4;
const ANNOUNCEMENTS_PAGE_SIZE = 20;

declare global {
  // eslint-disable-next-line no-var
  var __psxNotificationScheduler: NodeJS.Timeout | undefined;
  // eslint-disable-next-line no-var
  var __psxNotificationTickInFlight: Promise<void> | undefined;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

interface SessionWatcher {
  sessionId: string;
  symbol: string;
}

async function getDistinctWatchedSymbols(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ symbol: portfolioHoldings.symbol })
    .from(portfolioHoldings);
  return rows.map((r) => r.symbol.toUpperCase()).filter(Boolean);
}

async function getWatchersForSymbols(symbols: string[]): Promise<Map<string, string[]>> {
  if (symbols.length === 0) return new Map();
  const rows = await db
    .select({ sessionId: portfolioHoldings.sessionId, symbol: portfolioHoldings.symbol })
    .from(portfolioHoldings)
    .where(inArray(portfolioHoldings.symbol, symbols));
  const map = new Map<string, string[]>();
  for (const row of rows as SessionWatcher[]) {
    const sym = row.symbol.toUpperCase();
    const arr = map.get(sym) ?? [];
    if (!arr.includes(row.sessionId)) arr.push(row.sessionId);
    map.set(sym, arr);
  }
  return map;
}

async function getCursor(symbol: string): Promise<number> {
  const rows = await db
    .select()
    .from(notificationCursors)
    .where(eq(notificationCursors.symbol, symbol));
  return rows[0]?.lastAnnouncementId ?? 0;
}

async function setCursor(symbol: string, lastAnnouncementId: number) {
  await db
    .insert(notificationCursors)
    .values({ symbol, lastAnnouncementId, lastPolledAt: new Date() })
    .onConflictDoUpdate({
      target: notificationCursors.symbol,
      set: { lastAnnouncementId, lastPolledAt: new Date() },
    });
}

async function fetchPreferencesMap(
  sessionIds: string[],
): Promise<Map<string, { categories: string[]; email: string | null; emailEnabled: boolean; inAppEnabled: boolean }>> {
  if (sessionIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(notificationPreferences)
    .where(inArray(notificationPreferences.sessionId, sessionIds));
  const map = new Map<string, { categories: string[]; email: string | null; emailEnabled: boolean; inAppEnabled: boolean }>();
  for (const row of rows) {
    map.set(row.sessionId, {
      categories: Array.isArray(row.categories) ? row.categories : [],
      email: row.email,
      emailEnabled: row.emailEnabled,
      inAppEnabled: row.inAppEnabled,
    });
  }
  return map;
}

function passesCategoryFilter(category: AnnouncementCategory, prefCategories: string[]): boolean {
  if (!prefCategories || prefCategories.length === 0) return true;
  return prefCategories.includes(category);
}

interface ProcessedAnnouncement {
  announcement: Announcement;
  category: AnnouncementCategory;
}

async function fetchLatestAnnouncementsForSymbol(symbol: string): Promise<ProcessedAnnouncement[]> {
  try {
    const payload = await PSXApi.getAnnouncements({ symbol, page: 1, limit: ANNOUNCEMENTS_PAGE_SIZE });
    return (payload.data || []).map(({ d }) => ({
      announcement: {
        ...d,
        pdf_id: sanitizeAnnouncementLink(d.pdf_id ?? null),
        image_link: sanitizeAnnouncementLink(d.image_link ?? null),
      },
      category: classifyAnnouncement(d),
    }));
  } catch (err) {
    logger.warn({ err, symbol }, 'notifications: failed to fetch announcements for symbol');
    return [];
  }
}

async function processSymbol(symbol: string, watcherSessions: string[]): Promise<number> {
  const cursor = await getCursor(symbol);
  const items = await fetchLatestAnnouncementsForSymbol(symbol);
  if (items.length === 0) return 0;

  // Sort ascending by id so we insert in order and track the new max.
  const sorted = [...items].sort((a, b) => a.announcement.id - b.announcement.id);
  const fresh = sorted.filter((it) => it.announcement.id > cursor);

  // First-time observation: just seed the cursor and don't notify on backlog.
  if (cursor === 0) {
    const maxId = sorted[sorted.length - 1].announcement.id;
    await setCursor(symbol, maxId);
    return 0;
  }

  if (fresh.length === 0) return 0;

  const prefsMap = await fetchPreferencesMap(watcherSessions);
  let inserted = 0;

  for (const { announcement, category } of fresh) {
    for (const sessionId of watcherSessions) {
      const prefs = prefsMap.get(sessionId);
      // Category filter applies to both delivery channels uniformly.
      if (!passesCategoryFilter(category, prefs?.categories ?? [])) continue;

      const inAppEnabled = prefs?.inAppEnabled ?? true;
      const wantsEmail = !!(prefs?.emailEnabled && prefs.email);
      // Skip entirely only if both channels are disabled — there's nothing to deliver.
      if (!inAppEnabled && !wantsEmail) continue;

      try {
        // Always persist a notification row. This is the single source of truth
        // for "we already delivered announcement X to session Y" and is what
        // makes the unique (session_id, announcement_id) dedup work whether the
        // user has in-app, email, or both enabled. The GET /notifications route
        // hides rows from sessions that have in-app disabled.
        const insertedRows = await db
          .insert(notifications)
          .values({
            sessionId,
            announcementId: announcement.id,
            symbol: announcement.symbol?.toUpperCase() ?? symbol,
            category,
            title: announcement.title || `${category} announcement`,
            announcementDate: announcement.date ?? null,
            payload: announcement as unknown as Record<string, unknown>,
            emailSent: false,
          })
          .onConflictDoNothing({
            target: [notifications.sessionId, notifications.announcementId],
          })
          .returning({ id: notifications.id });

        if (insertedRows.length === 0) continue; // already delivered before

        inserted += 1;

        if (wantsEmail) {
          try {
            const sent = await sendAnnouncementEmail({
              to: prefs!.email!,
              symbol: announcement.symbol?.toUpperCase() ?? symbol,
              category,
              title: announcement.title || `${category} announcement`,
              date: announcement.date ?? null,
            });
            if (sent) {
              await db
                .update(notifications)
                .set({ emailSent: true })
                .where(eq(notifications.id, insertedRows[0].id));
            }
          } catch (err) {
            logger.warn({ err, sessionId }, 'notifications: email send failed');
          }
        }
      } catch (err) {
        logger.warn({ err, sessionId, announcementId: announcement.id }, 'notifications: insert failed');
      }
    }
  }

  const maxId = fresh[fresh.length - 1].announcement.id;
  await setCursor(symbol, maxId);
  return inserted;
}

async function tick(): Promise<number> {
  const symbols = await getDistinctWatchedSymbols();
  if (symbols.length === 0) return 0;

  const watchersBySymbol = await getWatchersForSymbols(symbols);

  const counts = await mapWithConcurrency(symbols, SYMBOL_FETCH_CONCURRENCY, async (symbol) => {
    const watchers = watchersBySymbol.get(symbol) ?? [];
    if (watchers.length === 0) return 0;
    return processSymbol(symbol, watchers);
  });

  const totalInserted = counts.reduce((acc, n) => acc + n, 0);
  if (totalInserted > 0) {
    logger.info({ totalInserted, symbolCount: symbols.length }, 'notifications: tick complete');
  }
  return totalInserted;
}

export async function runNotificationsTickNow(): Promise<{ inserted: number }> {
  if (globalThis.__psxNotificationTickInFlight) {
    await globalThis.__psxNotificationTickInFlight;
    return { inserted: 0 };
  }
  let inserted = 0;
  globalThis.__psxNotificationTickInFlight = (async () => {
    try {
      inserted = await tick();
    } catch (err) {
      logger.error({ err }, 'notifications: manual tick failed');
    } finally {
      globalThis.__psxNotificationTickInFlight = undefined;
    }
  })();
  await globalThis.__psxNotificationTickInFlight;
  return { inserted };
}

export function ensureNotificationsScheduler() {
  if (globalThis.__psxNotificationScheduler) return;
  logger.info('Notifications scheduler armed');
  globalThis.__psxNotificationScheduler = setInterval(() => {
    if (globalThis.__psxNotificationTickInFlight) return;
    globalThis.__psxNotificationTickInFlight = (async () => {
      try {
        await tick();
      } catch (err) {
        logger.error({ err }, 'notifications: scheduler tick failed');
      } finally {
        globalThis.__psxNotificationTickInFlight = undefined;
      }
    })();
  }, TICK_MS);
  // Initial tick at boot (delayed slightly so the server can finish wiring up).
  setTimeout(() => {
    if (globalThis.__psxNotificationTickInFlight) return;
    globalThis.__psxNotificationTickInFlight = (async () => {
      try {
        await tick();
      } catch (err) {
        logger.error({ err }, 'notifications: initial tick failed');
      } finally {
        globalThis.__psxNotificationTickInFlight = undefined;
      }
    })();
  }, 5_000);
}

// Re-export sql so the count query in routes can stay in one place if needed.
export { sql, and };
