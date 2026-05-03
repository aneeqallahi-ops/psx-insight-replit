import { ExternalLink } from 'lucide-react';

export type CitationKind = 'price' | 'fundamentals' | 'news' | 'market';

export interface Citation {
  kind: CitationKind;
  title: string;
  source: string;
  url?: string;
  asOf?: string;
}

const KIND_LABEL: Record<CitationKind, string> = {
  price: 'Price',
  fundamentals: 'Fundamentals',
  news: 'News',
  market: 'Market',
};

export function CitationList({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;
  return (
    <details className="rounded border border-line bg-black/20 p-3">
      <summary className="cursor-pointer text-xs uppercase tracking-wide text-gray-500">
        Sources ({citations.length})
      </summary>
      <ul className="mt-3 space-y-2 text-xs text-gray-400">
        {citations.map((c, i) => (
          <li key={i} className="flex items-start gap-2 leading-5">
            <span className="mt-0.5 shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-500">
              {KIND_LABEL[c.kind] ?? c.kind}
            </span>
            <span className="flex-1">
              {c.url ? (
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-coral underline-offset-2 hover:text-coral hover:underline"
                >
                  {c.title}
                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                </a>
              ) : (
                <span className="text-gray-300">{c.title}</span>
              )}
              <span className="text-gray-600"> · {c.source}</span>
              {c.asOf ? <span className="text-gray-600"> · {c.asOf}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
