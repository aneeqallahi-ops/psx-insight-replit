export const PORTFOLIO_KEY_STORAGE = 'psx_portfolio_key';

export type FilerStatus = 'filer' | 'non-filer';

export interface TaxProfile {
  filerStatus: FilerStatus;
  setAt: string;
}

export interface Holding {
  symbol: string;
  shares: number;
  avgBuyPrice: number;
  buyDate: string;
  drip: boolean;
  addedAt: string;
}

export function calculateDividendTax(grossAmount: number, filerStatus: FilerStatus, isExemptCompany = false) {
  const rates = {
    filer: { standard: 0.15, exempt: 0.25 },
    'non-filer': { standard: 0.30, exempt: 0.50 },
  };
  const rate = isExemptCompany ? rates[filerStatus].exempt : rates[filerStatus].standard;
  return {
    grossDividend: grossAmount,
    whtRate: rate,
    whtAmount: grossAmount * rate,
    netDividend: grossAmount * (1 - rate),
  };
}

export function calculateCapitalGainsTax(gainAmount: number, filerStatus: FilerStatus) {
  const rate = 0.15;
  return {
    gainAmount,
    filerStatus,
    cgtRate: rate,
    cgtAmount: Math.max(0, gainAmount) * rate,
    note:
      filerStatus === 'non-filer'
        ? '15% minimum floor; actual tax may be higher depending on income slab.'
        : '15% flat withholding rate for listed securities.',
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getPortfolioKey(): string {
  if (typeof window === 'undefined') return '';
  let key = window.localStorage.getItem(PORTFOLIO_KEY_STORAGE);
  if (!key || !UUID_RE.test(key)) {
    key = crypto.randomUUID();
    window.localStorage.setItem(PORTFOLIO_KEY_STORAGE, key);
  }
  return key;
}

export function setPortfolioKey(key: string): boolean {
  if (!UUID_RE.test(key)) return false;
  window.localStorage.setItem(PORTFOLIO_KEY_STORAGE, key.toLowerCase());
  return true;
}

function apiHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'X-Portfolio-Key': getPortfolioKey(),
  };
}

export async function fetchPortfolioFromApi(): Promise<Holding[]> {
  const res = await fetch('/api/portfolio/positions', {
    headers: { 'X-Portfolio-Key': getPortfolioKey() },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('Unable to load portfolio positions');
  const data = await res.json() as { positions: Holding[] };
  return data.positions
    .filter((h) => h.symbol && h.shares > 0 && h.avgBuyPrice > 0)
    .map((h) => ({ ...h, symbol: h.symbol.toUpperCase() }));
}

export async function savePortfolioToApi(holdings: Holding[]): Promise<void> {
  const res = await fetch('/api/portfolio/positions', {
    method: 'PUT',
    headers: apiHeaders(),
    body: JSON.stringify({ positions: holdings }),
  });
  if (!res.ok) throw new Error('Unable to save portfolio');
}

export async function fetchTaxProfileFromApi(): Promise<TaxProfile | null> {
  const res = await fetch('/api/portfolio/tax-profile', {
    headers: { 'X-Portfolio-Key': getPortfolioKey() },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = await res.json() as { taxProfile: TaxProfile | null };
  const profile = data.taxProfile;
  if (!profile || (profile.filerStatus !== 'filer' && profile.filerStatus !== 'non-filer')) return null;
  return profile;
}

export async function saveTaxProfileToApi(profile: TaxProfile): Promise<void> {
  const res = await fetch('/api/portfolio/tax-profile', {
    method: 'PUT',
    headers: apiHeaders(),
    body: JSON.stringify({ filerStatus: profile.filerStatus, setAt: profile.setAt }),
  });
  if (!res.ok) throw new Error('Unable to save tax profile');
}

export function upsertHolding(holdings: Holding[], nextHolding: Holding) {
  const symbol = nextHolding.symbol.toUpperCase();
  const existing = holdings.find((h) => h.symbol === symbol);
  if (!existing) {
    return [...holdings, { ...nextHolding, symbol }];
  }
  const totalShares = existing.shares + nextHolding.shares;
  const avgBuyPrice = ((existing.shares * existing.avgBuyPrice) + (nextHolding.shares * nextHolding.avgBuyPrice)) / totalShares;
  return holdings.map((h) =>
    h.symbol === symbol
      ? { ...h, shares: totalShares, avgBuyPrice, buyDate: existing.buyDate <= nextHolding.buyDate ? existing.buyDate : nextHolding.buyDate, drip: h.drip || nextHolding.drip }
      : h,
  );
}

export function makeHolding(symbol: string, shares: number, avgBuyPrice: number, buyDate: string, drip: boolean): Holding {
  return {
    symbol: symbol.toUpperCase(),
    shares,
    avgBuyPrice,
    buyDate,
    drip,
    addedAt: new Date().toISOString(),
  };
}
