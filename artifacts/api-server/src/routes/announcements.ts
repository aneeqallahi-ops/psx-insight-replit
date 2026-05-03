import { Router } from 'express';
import { PSXApi } from '../lib/psx-api';
import type { Announcement } from '../lib/types';
import {
  classifyAnnouncement,
  sanitizeAnnouncementLink,
  type AnnouncementCategory,
} from '../lib/announcement-classifier';

export type { AnnouncementCategory };

const router = Router();

function flatten(payload: { data: { d: Announcement }[] }) {
  return (payload.data || []).map(({ d }) => ({
    ...d,
    pdf_id: sanitizeAnnouncementLink(d.pdf_id ?? null),
    image_link: sanitizeAnnouncementLink(d.image_link ?? null),
    category: classifyAnnouncement(d),
  }));
}

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

  const hasFilter = Boolean(category) || Boolean(from) || Boolean(to) || upcoming;

  try {
    if (hasFilter) {
      const SWEEP_PAGES = symbol ? 1 : 5;
      const PAGE_SIZE = 20;
      const today = todayISO();
      const allItems: ReturnType<typeof flatten> = [];
      let lastPagination: Awaited<ReturnType<typeof PSXApi.getAnnouncements>>['pagination'] | undefined;
      for (let p = 1; p <= SWEEP_PAGES; p++) {
        const payload = await PSXApi.getAnnouncements({ symbol, page: p, limit: PAGE_SIZE });
        lastPagination = payload.pagination;
        const sliceItems = flatten(payload).filter((it) => {
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
        allItems.push(...sliceItems);
        if (!payload.pagination?.hasNext) break;
      }
      const start = (page - 1) * PAGE_SIZE;
      const pageItems = allItems.slice(start, start + PAGE_SIZE);
      const totalPages = Math.max(1, Math.ceil(allItems.length / PAGE_SIZE));
      res.json({
        symbol: symbol ?? null,
        page,
        limit: PAGE_SIZE,
        pagination: {
          total: allItems.length,
          page,
          limit: PAGE_SIZE,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
          filtered: true,
          sweptPages: SWEEP_PAGES,
          upstreamTotal: lastPagination?.total ?? null,
        },
        items: pageItems,
        updatedAt: Date.now(),
      });
      return;
    }

    const payload = await PSXApi.getAnnouncements({ symbol, page, limit });
    res.json({
      symbol: symbol ?? null,
      page,
      limit,
      pagination: payload.pagination ?? null,
      items: flatten(payload),
      updatedAt: Date.now(),
    });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Unable to load announcements' });
  }
});

export default router;
