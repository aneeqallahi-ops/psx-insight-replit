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

export interface WebSocketTickUpdate {
  type: 'tickUpdate';
  symbol: string;
  market: MarketType;
  tick: {
    s: string;
    m: MarketType;
    st: MarketState;
    c: number;
    ch: number;
    pch: number;
    v: number;
    tr: number;
    val: number;
    h: number;
    l: number;
    bp: number;
    ap: number;
    bv: number;
    av: number;
    t: number;
  };
}
