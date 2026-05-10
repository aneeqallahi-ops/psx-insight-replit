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

// ---------------------------------------------------------------------------
// Lot-level portfolio (v2)
// ---------------------------------------------------------------------------

export type AcquisitionRegime =
  | 'pre_2013'
  | 'jul13_jun22'
  | 'jul22_jun24'
  | 'jul24_jun25'
  | 'post_jul25';

export interface LotSnapshot {
  id: number;
  symbol: string;
  acquisitionDate: string;
  acquisitionRegime: AcquisitionRegime;
  quantityPurchased: number;
  quantityRemaining: number;
  costPerShare: number;
  commissionPaid: number;
  source: 'manual' | 'dividend_reinvest' | 'csv_import';
  drip: boolean;
  notes: string | null;
  // computed
  currentPrice: number | null;
  currentValue: number | null;
  costBasisIfSoldToday: number | null;
  proceedsIfSoldToday: number | null;
  unrealizedGain: number | null;
  unrealizedGainPercent: number | null;
  holdingDays: number;
  cgtRateIfSoldToday: number;
  projectedCgtIfSoldToday: number | null;
  priceError: string | null;
}

export interface LotsSnapshotResponse {
  lots: LotSnapshot[];
  filerStatus: FilerStatus;
  asOf: number;
  backfilled: boolean;
  notice?: string;
}

export const REGIME_LABELS: Record<AcquisitionRegime, { label: string; short: string; tone: string }> = {
  pre_2013:    { label: 'Pre-2013 (exempt)',          short: 'Pre-2013',     tone: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' },
  jul13_jun22: { label: 'Jul 2013 – Jun 2022',        short: '2013–22',      tone: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200' },
  jul22_jun24: { label: 'Jul 2022 – Jun 2024',        short: '2022–24',      tone: 'border-amber-400/30 bg-amber-400/10 text-amber-200' },
  jul24_jun25: { label: 'Jul 2024 – Jun 2025',        short: '2024–25',      tone: 'border-orange-400/30 bg-orange-400/10 text-orange-200' },
  post_jul25:  { label: 'Post-Jul 2025 (15% flat)',   short: 'Post-Jul 25',  tone: 'border-rose-400/30 bg-rose-400/10 text-rose-200' },
};

export async function fetchLotsSnapshot(): Promise<LotsSnapshotResponse> {
  const res = await fetch('/api/portfolio/lots/snapshot', {
    headers: { 'X-Portfolio-Key': getPortfolioKey() },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('Unable to load portfolio lots');
  return res.json() as Promise<LotsSnapshotResponse>;
}

export interface NewLotInput {
  symbol: string;
  shares: number;
  buyPrice: number;
  buyDate: string;
  drip: boolean;
}

export async function addLotToApi(input: NewLotInput): Promise<void> {
  const res = await fetch('/api/portfolio/lots', {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({ ...input, symbol: input.symbol.toUpperCase() }),
  });
  if (!res.ok) throw new Error('Unable to add lot');
}

export async function deleteLotsForSymbolApi(symbol: string): Promise<void> {
  const res = await fetch(`/api/portfolio/lots/by-symbol/${encodeURIComponent(symbol.toUpperCase())}`, {
    method: 'DELETE',
    headers: { 'X-Portfolio-Key': getPortfolioKey() },
  });
  if (!res.ok) throw new Error('Unable to delete lots');
}
