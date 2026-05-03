import { Router } from 'express';
import { getNewsWithRefresh, getStoredNews } from '../lib/news-scraper';

const router = Router();

router.get('/news/latest', async (req, res) => {
  const requestedLimit = Number(req.query.limit ?? '20');
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 20;
  const symbol = (req.query.symbol as string)?.trim().toUpperCase();

  try {
    const articles = await Promise.race([
      getNewsWithRefresh(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('News scrape timeout')), 60_000)),
    ]);
    const filtered = symbol ? articles.filter((a) => a.symbols.includes(symbol)) : articles;
    res.json({ articles: filtered.slice(0, limit), count: Math.min(filtered.length, limit), limit });
  } catch (error) {
    try {
      const stored = await getStoredNews();
      if (stored.length > 0) {
        const filtered = symbol ? stored.filter((a) => a.symbols.includes(symbol)) : stored;
        res.json({ articles: filtered.slice(0, limit), count: Math.min(filtered.length, limit), limit, warning: 'Serving cached news; live refresh is temporarily unavailable.' });
        return;
      }
    } catch {
    }
    res.json({ articles: [], count: 0, limit, warning: error instanceof Error ? error.message : 'Unable to load news. Please try again later.' });
  }
});

export default router;
