import { Router } from 'express';
import type { Announcement } from '../lib/types';
import {
  classifyAnnouncement,
  sanitizeAnnouncementLink,
  type AnnouncementCategory,
} from '../lib/announcement-classifier';
import { fetchAllAnnouncements } from '../lib/psx-announcements';

export type { AnnouncementCategory };

const router = Router();

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function parseDateParam(v: unknown): string | undefined {
  if (typeof v !== 'string' || !ISO_DATE_RE.test(v)) return undefined;
  const t = Date.parse(v + 'T00:00:00Z');
  if (!Number.isFinite(t)) return undefined;
  return v;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateOnly(v: string | null | undefined): string | null {
  if (!v || typeof v !== 'string') return null;
  const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

router.get('/announcements', async (req, res) => {
  const symbol = (req.query.symbol as string)?.toUpperCase().trim() || undefined;
  const pageRaw = parseInt(String(req.query.page ?? '1'), 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limitRaw = parseInt(String(req.query.limit ?? '20'), 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 20) : 20;
  const category = ((req.query.category as string) || '').toUpperCase() as AnnouncementCategory | '';
  const from = parseDateParam(req.query.from);
  const to = parseDateParam(req.query.to);
  const upcoming = String(req.query.upcoming ?? '') === '1';

  try {
    const all = await fetchAllAnnouncements();
    const today = todayISO();

    // Enrich + filter in one pass.
    const enriched = all
      .map((r) => {
        const record = { ...(r as Announcement) };
        record.pdf_id = sanitizeAnnouncementLink(record.pdf_id ?? null);
        record.image_link = sanitizeAnnouncementLink(record.image_link ?? null);
        return { ...record, category: classifyAnnouncement(record) };
      })
      .filter((it) => {
        if (symbol && it.symbol !== symbol) return false;
        if (category && it.category !== category) return false;
        const d = dateOnly(it.date);
        if (from && (!d || d < from)) return false;
        if (to && (!d || d > to)) return false;
        if (upcoming) {
          const future = [it.ex_date, it.held_date, it.book_closure_date_from, it.entitlement_paid_date, it.period_end_date]
            .map(dateOnly)
            .some((x) => x != null && x >= today);
          if (!future) return false;
        }
        return true;
      });

    // Newest first (portal already sorts, but be explicit).
    enriched.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const total = enriched.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const items = enriched.slice((page - 1) * limit, page * limit);

    res.json({
      symbol: symbol ?? null,
      page,
      limit,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
      items,
      updatedAt: Date.now(),
    });
  } catch (error) {
    res.json({
      symbol: symbol ?? null,
      page,
      limit,
      pagination: null,
      items: [],
      updatedAt: Date.now(),
      warning: error instanceof Error ? error.message : 'Announcements upstream is temporarily unavailable',
    });
  }
});

export default router;
