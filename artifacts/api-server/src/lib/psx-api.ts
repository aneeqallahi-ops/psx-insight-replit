import type {
  AnnouncementsResponse,
  BreadthStats,
  CompanyInfo,
  Dividend,
  Fundamentals,
  Kline,
  MarketStats,
  SectorData,
  Tick,
} from './types';
import { withCache, TTL } from './cache';

const BASE_URL = process.env.PSX_BASE_URL || 'https://psxterminal.com';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DEFAULT_HEADERS = {
  'Accept': 'application/json',
  'User-Agent': UA,
};

async function fetchPSX<T>(path: string, retries = 2): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        headers: DEFAULT_HEADERS,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`PSX API error: ${res.status} on ${path}`);
      const json = (await res.json()) as { success: boolean; data: T };
      if (!json.success) throw new Error(`PSX API returned success:false on ${path}`);
      return json.data;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw lastError!;
}

// /api/status has no { success, data } wrapper — handled separately
async function fetchStatus(): Promise<{ status: string; timestamp: string; uptime: number }> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/api/status`, {
        headers: DEFAULT_HEADERS,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`PSX status error: ${res.status}`);
      return await res.json() as { status: string; timestamp: string; uptime: number };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < 2) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw lastError!;
}

export const PSXApi = {
  getStatus: () =>
    withCache('status', TTL.STATUS, () => fetchStatus()),

  getSymbols: () =>
    withCache('symbols', TTL.SYMBOLS, () => fetchPSX<string[]>('/api/symbols')),

  getTick: (type: string, symbol: string) =>
    fetchPSX<Tick>(`/api/ticks/${type}/${symbol}`),

  getStats: (type: string) =>
    withCache(`stats:${type}`, TTL.STATS, () =>
      fetchPSX<MarketStats | BreadthStats | Record<string, SectorData>>(`/api/stats/${type}`),
    ),

  getFundamentals: (symbol: string) =>
    withCache(`fundamentals:${symbol}`, TTL.FUNDAMENTALS, () =>
      fetchPSX<Fundamentals>(`/api/fundamentals/${symbol}`, 1),
    ),

  getCompany: (symbol: string) =>
    withCache(`company:${symbol}`, TTL.COMPANY, () =>
      fetchPSX<CompanyInfo>(`/api/companies/${symbol}`, 1),
    ),

  getDividends: (symbol: string) =>
    withCache(`dividends:${symbol}`, TTL.DIVIDENDS, () =>
      fetchPSX<Dividend[]>(`/api/dividends/${symbol}`, 1),
    ),

  getAnnouncements: (params?: { symbol?: string; page?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.symbol) query.set('symbol', params.symbol);
    if (params?.page) query.set('page', params.page.toString());
    if (params?.limit) query.set('limit', params.limit.toString());
    const qs = query.toString();
    const path = `/api/announcements${qs ? '?' + qs : ''}`;
    return withCache(`announcements:${qs}`, TTL.ANNOUNCEMENTS, async () => {
      let lastError: Error | null = null;
      for (let attempt = 0; attempt <= 2; attempt++) {
        try {
          const res = await fetch(`${BASE_URL}${path}`, {
            headers: DEFAULT_HEADERS,
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) throw new Error(`PSX announcements error: ${res.status}`);
          return await res.json() as AnnouncementsResponse;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (attempt < 2) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        }
      }
      throw lastError!;
    });
  },

  getKlines: (symbol: string, timeframe: string, params?: { start?: number; end?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.start) query.set('start', params.start.toString());
    if (params?.end) query.set('end', params.end.toString());
    if (params?.limit) query.set('limit', params.limit.toString());
    const qs = query.toString();
    const path = `/api/klines/${symbol}/${timeframe}${qs ? '?' + qs : ''}`;
    return withCache(`klines:${symbol}:${timeframe}:${qs}`, TTL.KLINES, () =>
      fetchPSX<Kline[]>(path, 1),
    );
  },
};
