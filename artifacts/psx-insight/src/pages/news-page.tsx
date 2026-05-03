import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Link } from 'wouter';
import { useMemo, useState } from 'react';

interface NewsArticle {
  headline: string;
  url: string;
  category: string;
  publishedAt: string;
  summary: string;
  symbols: string[];
  source?: string;
}

interface NewsResponse {
  articles: NewsArticle[];
  count: number;
}

async function fetchNews(): Promise<NewsResponse> {
  const res = await fetch('/api/news/latest?limit=100', { cache: 'no-store' });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new Error(payload?.error || 'Unable to load news');
  }
  return res.json();
}

function categoryGroup(article: NewsArticle) {
  const text = `${article.category} ${article.source ?? ''} ${article.headline}`.toLowerCase();
  if (text.includes('announcement') || text.includes('notice') || text.includes('exchange')) return 'Announcements';
  if (text.includes('monetary') || text.includes('sbp') || text.includes('policy') || text.includes('macro')) return 'Macro';
  if (text.includes('result') || text.includes('earnings') || text.includes('profit')) return 'Results';
  return article.category || 'Other';
}

export function NewsPage() {
  const [category, setCategory] = useState('All');
  const { data, error, isFetching, isLoading } = useQuery({
    queryKey: ['news-feed'],
    queryFn: fetchNews,
    refetchInterval: 30_000,
  });
  const articles = data?.articles ?? [];
  const groupedArticles = useMemo(
    () => articles.map((a) => ({ ...a, categoryGroup: categoryGroup(a) })),
    [articles],
  );
  const categories = useMemo(
    () => ['All', ...Array.from(new Set(groupedArticles.map((a) => a.categoryGroup))).sort()],
    [groupedArticles],
  );
  const visibleArticles = groupedArticles.filter((a) => (category === 'All' ? true : a.categoryGroup === category));

  return (
    <main className="min-h-[calc(100vh-120px)] px-4 py-8 lg:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-line pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="font-mono text-[10px] text-coral tracking-widest">005 // NEWS</span>
            <h1 className="mt-2 font-display text-4xl tracking-wide text-white lg:text-6xl">MARKET NEWS FEED</h1>
            <p className="mt-3 font-mono text-xs uppercase tracking-wider leading-relaxed text-gray-500">// METTIS · PSX ANNOUNCEMENTS · SBP PRESS RELEASES</p>
          </div>
          <div className="rounded border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm font-medium text-emerald-200">
            {isFetching ? 'Refreshing' : `${visibleArticles.length} articles`}
          </div>
        </header>

        {error ? (
          <div className="rounded border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-100">
            {error instanceof Error ? error.message : 'Unable to load news'}
          </div>
        ) : null}

        <div className="rounded border border-line bg-panel p-4">
          <label className="text-sm text-gray-400" htmlFor="category-filter">Category</label>
          <select
            id="category-filter"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="mt-2 h-11 w-full rounded border border-line bg-black/20 px-4 text-sm text-white outline-none focus:border-coral/60 sm:w-72"
          >
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <section className="flex flex-col gap-4">
          {visibleArticles.length > 0 ? (
            visibleArticles.map((article) => (
              <article key={article.url} className="rounded border border-line bg-panel p-5 transition hover:border-coral/30">
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span>{article.source ?? 'News'}</span>
                  <span>·</span>
                  <span>{formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true })}</span>
                  <span className="rounded border border-coral/30 bg-coral/10 px-2 py-1 text-coral">{article.categoryGroup}</span>
                </div>
                <a href={article.url} target="_blank" rel="noreferrer" className="mt-3 block text-xl font-semibold text-white hover:underline">
                  {article.headline}
                </a>
                <p className="mt-3 text-sm leading-6 text-gray-400">{article.summary}</p>
                {article.symbols.length ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {article.symbols.map((symbol) => (
                      <Link
                        key={`${article.url}-${symbol}`}
                        href={`/stock?symbol=${encodeURIComponent(symbol)}`}
                        className="rounded border border-coral/30 bg-coral/10 px-2 py-1 text-xs font-medium text-coral hover:underline"
                      >
                        {symbol}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </article>
            ))
          ) : (
            <div className="rounded border border-line bg-panel p-6 text-sm text-gray-500">
              {isLoading ? 'Loading news' : 'No articles match the current category.'}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
