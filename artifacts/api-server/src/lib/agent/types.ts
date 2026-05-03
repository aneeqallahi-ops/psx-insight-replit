export type CitationKind = 'price' | 'fundamentals' | 'news' | 'market';

export interface Citation {
  kind: CitationKind;
  title: string;
  source: string;
  url?: string;
  asOf?: string;
}
