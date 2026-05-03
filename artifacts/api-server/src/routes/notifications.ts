import { Router } from 'express';
import { db } from '@workspace/db';
import { notificationPreferences, notifications } from '@workspace/db/schema';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ALL_CATEGORIES, type AnnouncementCategory } from '../lib/announcement-classifier';
import { runNotificationsTickNow } from '../lib/notifications/scheduler';

const router = Router();

const categoryEnum = z.enum(ALL_CATEGORIES as [AnnouncementCategory, ...AnnouncementCategory[]]);

// PATCH-style: any omitted field keeps its existing value, so partial updates
// from the UI never accidentally clear other preferences.
const putPreferencesSchema = z.object({
  categories: z.array(categoryEnum).max(ALL_CATEGORIES.length).optional(),
  email: z.string().email().max(254).nullable().optional(),
  emailEnabled: z.boolean().optional(),
  inAppEnabled: z.boolean().optional(),
});

const markReadSchema = z.object({
  ids: z.array(z.number().int().positive()).max(500).optional(),
  all: z.boolean().optional(),
});

router.get('/notifications', async (req, res) => {
  const sessionId = req.portfolioSessionId;
  const limitRaw = parseInt(String(req.query.limit ?? '50'), 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
  const unreadOnly = String(req.query.unread ?? '').toLowerCase() === 'true';

  // If the user has disabled in-app notifications, return an empty inbox even
  // though we may still be writing rows (and sending emails) on their behalf.
  const prefRows = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.sessionId, sessionId));
  const inAppEnabled = prefRows.length === 0 ? true : prefRows[0].inAppEnabled;

  if (!inAppEnabled) {
    res.json({ items: [], unreadCount: 0, updatedAt: Date.now(), inAppDisabled: true });
    return;
  }

  const where = unreadOnly
    ? and(eq(notifications.sessionId, sessionId), isNull(notifications.readAt))
    : eq(notifications.sessionId, sessionId);

  const items = await db
    .select()
    .from(notifications)
    .where(where)
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  const [{ unreadCount } = { unreadCount: 0 }] = await db
    .select({ unreadCount: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.sessionId, sessionId), isNull(notifications.readAt)));

  res.json({
    items: items.map((row) => ({
      id: row.id,
      announcementId: row.announcementId,
      symbol: row.symbol,
      category: row.category,
      title: row.title,
      announcementDate: row.announcementDate,
      payload: row.payload,
      emailSent: row.emailSent,
      createdAt: row.createdAt,
      readAt: row.readAt,
    })),
    unreadCount: Number(unreadCount ?? 0),
    updatedAt: Date.now(),
  });
});

router.post('/notifications/mark-read', async (req, res) => {
  const sessionId = req.portfolioSessionId;
  const parsed = markReadSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    return;
  }
  const { ids, all } = parsed.data;

  const where = all
    ? and(eq(notifications.sessionId, sessionId), isNull(notifications.readAt))
    : ids && ids.length > 0
      ? and(eq(notifications.sessionId, sessionId), inArray(notifications.id, ids))
      : null;

  if (!where) {
    res.status(400).json({ error: 'Specify ids[] or all=true' });
    return;
  }

  await db.update(notifications).set({ readAt: new Date() }).where(where);
  res.json({ ok: true });
});

router.get('/notifications/preferences', async (req, res) => {
  const sessionId = req.portfolioSessionId;
  const rows = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.sessionId, sessionId));
  if (rows.length === 0) {
    res.json({
      preferences: {
        categories: [],
        email: null,
        emailEnabled: false,
        inAppEnabled: true,
      },
    });
    return;
  }
  const row = rows[0];
  res.json({
    preferences: {
      categories: Array.isArray(row.categories) ? row.categories : [],
      email: row.email,
      emailEnabled: row.emailEnabled,
      inAppEnabled: row.inAppEnabled,
    },
  });
});

router.put('/notifications/preferences', async (req, res) => {
  const sessionId = req.portfolioSessionId;
  const parsed = putPreferencesSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid preferences', details: parsed.error.flatten() });
    return;
  }

  const existing = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.sessionId, sessionId));
  const current = existing[0];

  const nextCategories = parsed.data.categories ?? (current?.categories ?? []);
  const rawEmail = parsed.data.email !== undefined ? parsed.data.email : current?.email ?? null;
  const cleanEmail = rawEmail && rawEmail.trim() ? rawEmail.trim().toLowerCase() : null;
  const requestedEmailEnabled =
    parsed.data.emailEnabled !== undefined ? parsed.data.emailEnabled : current?.emailEnabled ?? false;
  // Sanity: cannot enable email alerts without an email address.
  const cleanEmailEnabled = requestedEmailEnabled && !!cleanEmail;
  const nextInApp =
    parsed.data.inAppEnabled !== undefined ? parsed.data.inAppEnabled : current?.inAppEnabled ?? true;

  await db
    .insert(notificationPreferences)
    .values({
      sessionId,
      categories: nextCategories,
      email: cleanEmail,
      emailEnabled: cleanEmailEnabled,
      inAppEnabled: nextInApp,
    })
    .onConflictDoUpdate({
      target: notificationPreferences.sessionId,
      set: {
        categories: nextCategories,
        email: cleanEmail,
        emailEnabled: cleanEmailEnabled,
        inAppEnabled: nextInApp,
        updatedAt: new Date(),
      },
    });

  res.json({ ok: true });
});

// Force a global scheduler tick. This is a development-only convenience for
// testing the polling pipeline; in production we rely solely on the 15-minute
// scheduler interval to avoid letting any session-key holder trigger expensive
// PSX API fan-out / DB writes on demand.
router.post('/notifications/poll-now', async (_req, res) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(403).json({ error: 'Disabled in production' });
    return;
  }
  const result = await runNotificationsTickNow();
  res.json({ ok: true, inserted: result.inserted });
});

export default router;
