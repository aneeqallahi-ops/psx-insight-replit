export type MarketType = 'REG' | 'FUT' | 'IDX' | 'ODL' | 'BNB';
export type MarketState = 'PRE' | 'OPN' | 'SUS' | 'CLS';
export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w' | '1M';

export interface Tick {
  symbol: string;
  market: MarketType;
  st: MarketState;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  trades: number;
  value: number;
  high: number;
  low: number;
  bid: number;
  ask: number;
  timestamp: number;
}

export interface MarketStats {
  totalVolume: number;
  totalValue: number;
  totalTrades: number;
  symbolCount: number;
  gainers: number;
  losers: number;
  unchanged: number;
  topGainers: TopMover[];
  topLosers: TopMover[];
}

export interface TopMover {
  symbol: string;
  change: number;
  changePercent: number;
  price: number;
  volume: number;
  value: number;
}

export interface BreadthStats {
  advances: number;
  declines: number;
  unchanged: number;
  advanceDeclineRatio: number;
  advanceDeclineSpread: number;
  advanceDeclinePercent: number;
  upVolume: number;
  downVolume: number;
  upDownVolumeRatio: number;
}

export interface SectorData {
  totalVolume: number;
  totalValue: number;
  totalTrades: number;
  gainers: number;
  losers: number;
  unchanged: number;
  avgChange: number;
  avgChangePercent: number;
  symbols: string[];
}

export interface Fundamentals {
  symbol: string;
  sector: string;
  listedIn: string;
  marketCap: string;
  price: number;
  changePercent: number;
  yearChange: number;
  peRatio: number;
  dividendYield: number;
  freeFloat: string;
  volume30Avg: number;
  isNonCompliant: boolean;
  exTag?: string | null;
  timestamp?: string;
}

export interface CompanyInfo {
  symbol: string;
  financialStats: {
    marketCap: { raw: string; numeric: number };
    shares: { raw: string; numeric: number };
    freeFloat: { raw: string; numeric: number };
    freeFloatPercent: { raw: string; numeric: number };
  };
  businessDescription: string;
  keyPeople: { name: string; position: string }[];
}

export interface Kline {
  symbol: string;
  timeframe: Timeframe;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Dividend {
  symbol: string;
  ex_date: string;
  payment_date: string;
  record_date: string;
  amount: number;
  year: number;
}

export interface Announcement {
  id: number;
  symbol: string;
  announcement_type: string;
  title: string;
  date: string;
  created_at: string;
  updated_at: string;
  content?: string | null;
  agenda?: string | null;
  pdf_id?: string | null;
  image_link?: string | null;
  dividend?: number | string | null;
  specie_dividend?: number | string | null;
  bonus?: number | string | null;
  right_issue?: number | string | null;
  right_price?: number | string | null;
  stock_split?: number | string | null;
  reverse_split?: number | string | null;
  book_closure_date_from?: string | null;
  book_closure_date_to?: string | null;
  ex_date?: string | null;
  entitlement_paid_date?: string | null;
  held_date?: string | null;
  period_end_date?: string | null;
  unconsolidated_eps?: number | string | null;
  consolidated_eps?: number | string | null;
  unconsolidated_pat?: number | string | null;
  consolidated_pat?: number | string | null;
  growth_in_pat?: number | string | null;
  quarter?: string | null;
  period?: string | null;
}

export interface AnnouncementsPagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface AnnouncementsResponse {
  data: { d: Announcement }[];
  pagination?: AnnouncementsPagination;
  count?: number;
}
