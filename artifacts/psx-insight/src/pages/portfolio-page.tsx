import { useQuery } from '@tanstack/react-query';
import { Bell, ChevronDown, ChevronUp, ClipboardCheck, Copy, Key, Pencil, PieChart, Search, Trash2, X } from 'lucide-react';
import { Fragment, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { PortfolioReviewModal } from '@/components/agent/portfolio-review-modal';
import { useMarketStatus } from '@/hooks/useMarketStatus';
import {
  calculateCapitalGainsTax,
  calculateDividendTax,
  fetchPortfolioFromApi,
  fetchTaxProfileFromApi,
  getPortfolioKey,
  makeHolding,
  savePortfolioToApi,
  saveTaxProfileToApi,
  setPortfolioKey,
  upsertHolding,
} from '@/lib/portfolio';
import type { FilerStatus, Holding, TaxProfile } from '@/lib/portfolio';
import type { Dividend, Fundamentals, Tick } from '@/lib/types';

interface SymbolsResponse { symbols: string[]; updatedAt: number; }
interface TickResponse { tick: Tick; updatedAt: number; }
interface PortfolioHoldingData { symbol: string; tick: Tick | null; fundamentals: Fundamentals | null; dividends: Dividend[]; error?: string; }
interface HoldingsResponse { items: PortfolioHoldingData[]; updatedAt: number; }
interface PendingHolding { holding: Holding; toastPrice: number; }

function today() { return new Date().toISOString().slice(0, 10); }
function money(value: number) { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, style: 'currency', currency: 'PKR' }).format(Number.isFinite(value) ? value : 0); }
function commaNumber(value: number) { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0); }
function ratioPercent(value: number) { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, style: 'percent' }).format(Number.isFinite(value) ? value : 0); }
function plainPercent(value: number) { return `${commaNumber(value)}%`; }
function parseDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; }

async function fetchSymbols(): Promise<SymbolsResponse> {
  const res = await fetch('/api/symbols', { cache: 'no-store' });
  if (!res.ok) throw new Error('Unable to load symbols');
  return res.json();
}

async function fetchTick(symbol: string): Promise<TickResponse> {
  const res = await fetch(`/api/stock/tick?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Unable to load ${symbol} price`);
  return res.json();
}

async function fetchHoldings(symbols: string[]): Promise<HoldingsResponse> {
  const params = new URLSearchParams({ symbols: symbols.join(',') });
  const res = await fetch(`/api/portfolio/holdings?${params.toString()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Unable to load portfolio holdings');
  return res.json();
}

function TaxProfileModal({ initialStatus, onSave, onClose, mustChoose }: { initialStatus: FilerStatus; onSave: (profile: TaxProfile) => void; onClose?: () => void; mustChoose: boolean }) {
  const [selected, setSelected] = useState<FilerStatus>(initialStatus);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 px-4">
      <div className="w-full max-w-2xl rounded border border-line bg-panel p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-white">Your Tax Profile</h2>
            <p className="mt-2 text-sm leading-6 text-gray-400">This helps us calculate your net dividend income accurately under Pakistan's Income Tax Ordinance.</p>
          </div>
          {!mustChoose && onClose ? (
            <button type="button" onClick={onClose} className="rounded border border-line p-2 text-gray-400 transition hover:text-white" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {[{ value: 'filer' as FilerStatus, title: 'Active Tax Filer (ATL)', subtext: "I am registered on FBR's Active Taxpayers List", tag: 'Dividend WHT: 15%' }, { value: 'non-filer' as FilerStatus, title: 'Non-Filer', subtext: "I am not currently on FBR's Active Taxpayers List", tag: 'Dividend WHT: 30%' }].map((option) => (
            <button key={option.value} type="button" onClick={() => setSelected(option.value)}
              className={`rounded border p-4 text-left transition ${selected === option.value ? 'border-coral/60 bg-coral/10' : 'border-line bg-black/20 hover:border-coral/30'}`}>
              <div className="flex items-start gap-3">
                <span className={`mt-1 h-4 w-4 rounded-full border ${selected === option.value ? 'border-coral bg-coral' : 'border-gray-600'}`} />
                <span>
                  <span className="block font-semibold text-white">{option.title}</span>
                  <span className="mt-2 block text-sm text-gray-400">{option.subtext}</span>
                  <span className="mt-4 inline-flex rounded border border-amber-300/30 bg-amber-400/10 px-2 py-1 text-xs font-medium text-amber-200">{option.tag}</span>
                </span>
              </div>
            </button>
          ))}
        </div>
        <button type="button" onClick={() => onSave({ filerStatus: selected, setAt: new Date().toISOString() })}
          className="mt-6 w-full rounded border border-coral/60 bg-coral/15 px-4 py-3 text-sm font-semibold text-coral transition hover:bg-coral/25">
          Continue
        </button>
        <p className="mt-5 text-xs leading-5 text-gray-500">WHT rates are based on Pakistan's Income Tax Ordinance (last updated January 2026). Standard company dividends: 15% filer, 30% non-filer. Not tax advice.</p>
      </div>
    </div>
  );
}

function PortfolioKeyPanel({ portfolioKey, onImport }: { portfolioKey: string; onImport: (key: string) => boolean }) {
  const [showImport, setShowImport] = useState(false);
  const [importValue, setImportValue] = useState('');
  const [importError, setImportError] = useState('');
  const [copied, setCopied] = useState(false);

  function copyKey() {
    navigator.clipboard.writeText(portfolioKey).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }).catch(() => undefined);
  }

  function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = importValue.trim();
    const ok = onImport(trimmed);
    if (!ok) {
      setImportError('Invalid key format. It should look like: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
      return;
    }
    setShowImport(false);
    setImportValue('');
    setImportError('');
    window.location.reload();
  }

  return (
    <div className="rounded border border-line bg-panel px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <Key className="h-4 w-4 text-gray-500 shrink-0" aria-hidden="true" />
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">Your portfolio key (save this to restore on another device):</span>
          <code className="rounded bg-black/30 px-2 py-0.5 text-xs font-mono text-coral select-all">{portfolioKey}</code>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={copyKey} className="flex items-center gap-1.5 rounded border border-line px-3 py-1.5 text-xs text-gray-300 transition hover:border-coral/50 hover:text-coral">
            <Copy className="h-3.5 w-3.5" />
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button type="button" onClick={() => setShowImport((v) => !v)} className="rounded border border-line px-3 py-1.5 text-xs text-gray-300 transition hover:border-coral/50 hover:text-coral">
            Use existing key
          </button>
        </div>
      </div>
      {showImport ? (
        <form onSubmit={submitImport} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start">
          <input
            value={importValue}
            onChange={(e) => { setImportValue(e.target.value); setImportError(''); }}
            placeholder="Paste your portfolio key here"
            className="flex-1 rounded border border-line bg-black/20 px-3 py-2 text-xs text-white outline-none placeholder:text-gray-600 focus:border-coral/60"
          />
          <button type="submit" className="rounded border border-coral/60 bg-coral/15 px-4 py-2 text-xs font-semibold text-coral transition hover:bg-coral/25">
            Switch to this key
          </button>
          {importError ? <p className="w-full text-xs text-rose-300">{importError}</p> : null}
        </form>
      ) : null}
    </div>
  );
}

function StatCard({ label, value, subtext, tone }: { label: string; value: string; subtext?: string; tone?: string }) {
  return (
    <div className="rounded border border-line bg-panel p-4">
      <p className="text-xs uppercase text-gray-500">{label}</p>
      <p className={`mt-2 text-lg font-semibold ${tone ?? 'text-white'}`}>{value}</p>
      {subtext ? <p className="mt-1 text-xs text-gray-500">{subtext}</p> : null}
    </div>
  );
}

function AddPositionCard({ symbols, holdings, onAdd }: { symbols: string[]; holdings: Holding[]; onAdd: (holding: Holding, toastPrice: number) => void }) {
  const [symbolSearch, setSymbolSearch] = useState('');
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [shares, setShares] = useState('100');
  const [priceMode, setPriceMode] = useState<'current' | 'manual'>('current');
  const [manualPrice, setManualPrice] = useState('');
  const [buyDate, setBuyDate] = useState(today());
  const [drip, setDrip] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [error, setError] = useState('');

  const tickQuery = useQuery({ queryKey: ['portfolio-add-tick', selectedSymbol], queryFn: () => fetchTick(selectedSymbol), enabled: Boolean(selectedSymbol), refetchOnWindowFocus: false });
  const currentPrice = tickQuery.data?.tick.price ?? null;
  const filteredSymbols = useMemo(() => { const query = symbolSearch.trim().toUpperCase(); return (!query ? symbols.slice(0, 12) : symbols.filter((s) => s.includes(query)).slice(0, 12)); }, [symbolSearch, symbols]);
  const selectedHolding = holdings.find((h) => h.symbol === selectedSymbol);

  function chooseSymbol(symbol: string) { setSelectedSymbol(symbol); setSymbolSearch(symbol); setDropdownOpen(false); setError(''); }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedShares = Number(shares);
    const selectedPrice = priceMode === 'current' ? currentPrice : Number(manualPrice);
    if (!selectedSymbol) { setError('Choose a symbol first.'); return; }
    if (!Number.isFinite(parsedShares) || parsedShares < 1) { setError('Enter at least 1 share.'); return; }
    if (!selectedPrice || !Number.isFinite(selectedPrice) || selectedPrice <= 0) { setError('Enter a valid buy price.'); return; }
    onAdd(makeHolding(selectedSymbol, parsedShares, selectedPrice, buyDate, drip), selectedPrice);
    setShares('100'); setManualPrice(''); setDrip(false); setError('');
  }

  return (
    <section className="rounded border border-line bg-panel p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-white">Add Position</h2>
        <p className="text-sm text-gray-500">Add PSX holdings and calculate dividends after withholding tax.</p>
      </div>
      <form onSubmit={submit} className="mt-5 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <div className="relative lg:col-span-2 xl:col-span-1">
          <label className="text-sm text-gray-300">Symbol
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600" />
              <input value={symbolSearch} onChange={(e) => { setSymbolSearch(e.target.value.toUpperCase()); setSelectedSymbol(''); setDropdownOpen(true); }} onFocus={() => setDropdownOpen(true)}
                placeholder="Search symbol" className="h-11 w-full rounded border border-line bg-black/20 pl-10 pr-3 text-white outline-none placeholder:text-gray-600 focus:border-coral/60" />
            </div>
          </label>
          {dropdownOpen ? (
            <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded border border-line bg-panel shadow-xl">
              {filteredSymbols.length > 0 ? filteredSymbols.map((symbol) => (
                <button key={symbol} type="button" onClick={() => chooseSymbol(symbol)} className="block w-full px-4 py-3 text-left text-sm text-gray-200 transition hover:bg-white/[0.05]">{symbol}</button>
              )) : <p className="px-4 py-3 text-sm text-gray-500">No matching symbols</p>}
            </div>
          ) : null}
          <p className="mt-2 text-xs text-gray-500">Current price: <span className="text-gray-300">{tickQuery.isFetching ? 'Loading' : currentPrice ? money(currentPrice) : '--'}</span></p>
          {selectedHolding ? <p className="mt-1 text-xs text-amber-200">Existing holding found. Adding will average your buy price.</p> : null}
        </div>

        <label className="text-sm text-gray-300">Number of shares
          <input value={shares} onChange={(e) => setShares(e.target.value)} type="number" min="1" step="1" className="mt-2 h-11 w-full rounded border border-line bg-black/20 px-3 text-white outline-none focus:border-coral/60" />
        </label>

        <label className="text-sm text-gray-300">Purchase date
          <input value={buyDate} onChange={(e) => setBuyDate(e.target.value)} type="date" className="mt-2 h-11 w-full rounded border border-line bg-black/20 px-3 text-white outline-none focus:border-coral/60" />
        </label>

        <div className="rounded border border-line bg-black/10 p-4 lg:col-span-2">
          <p className="text-sm font-medium text-gray-200">Buy price</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="flex items-start gap-3 rounded border border-line bg-black/20 p-3 text-sm text-gray-300">
              <input checked={priceMode === 'current'} onChange={() => setPriceMode('current')} type="radio" className="mt-1" />
              <span>Use current market price
                <input value={currentPrice ? money(currentPrice) : '--'} disabled className="mt-2 h-10 w-full rounded border border-line bg-black/20 px-3 text-gray-500" />
              </span>
            </label>
            <label className="flex items-start gap-3 rounded border border-line bg-black/20 p-3 text-sm text-gray-300">
              <input checked={priceMode === 'manual'} onChange={() => setPriceMode('manual')} type="radio" className="mt-1" />
              <span>Enter average buy price
                <input value={manualPrice} onChange={(e) => setManualPrice(e.target.value)} disabled={priceMode !== 'manual'} type="number" min="0.01" step="0.01" placeholder="PKR"
                  className="mt-2 h-10 w-full rounded border border-line bg-black/20 px-3 text-white outline-none placeholder:text-gray-600 disabled:text-gray-500" />
              </span>
            </label>
          </div>
        </div>

        <label className="flex items-start gap-3 rounded border border-line bg-black/10 p-4 text-sm text-gray-300">
          <input checked={drip} onChange={(e) => setDrip(e.target.checked)} type="checkbox" className="mt-1" />
          <span>Reinvest dividends automatically<span className="block text-xs text-gray-500">Net dividends after WHT will be converted to additional shares at current price.</span></span>
        </label>

        <div className="flex flex-col justify-end gap-2">
          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
          <button type="submit" className="h-11 rounded border border-coral/60 bg-coral/15 px-4 text-sm font-semibold text-coral transition hover:bg-coral/25">Add Position</button>
        </div>
      </form>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="grid place-items-center rounded border border-dashed border-line bg-panel px-6 py-16 text-center">
      <PieChart className="h-10 w-10 text-coral" aria-hidden="true" />
      <h2 className="mt-4 text-xl font-semibold text-white">No positions yet</h2>
      <p className="mt-2 max-w-md text-sm text-gray-500">Add your first stock above to start tracking your portfolio performance</p>
    </div>
  );
}

export function PortfolioPage() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [taxProfile, setTaxProfile] = useState<TaxProfile | null>(null);
  const [showTaxModal, setShowTaxModal] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [portfolioKey, setCurrentPortfolioKey] = useState('');
  const [pendingHolding, setPendingHolding] = useState<PendingHolding | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [toast, setToast] = useState('');
  const [expandedSymbol, setExpandedSymbol] = useState('');
  const [priceFlashes, setPriceFlashes] = useState<Record<string, 'up' | 'down'>>({});
  const previousPricesRef = useRef(new Map<string, number>());
  const notifiedRef = useRef(new Set<string>());
  const marketStatusQuery = useMarketStatus();
  const isMarketOpen = marketStatusQuery.data?.isOpen ?? false;

  useEffect(() => {
    const key = getPortfolioKey();
    setCurrentPortfolioKey(key);
    async function loadData() {
      const [loadedHoldings, loadedTaxProfile] = await Promise.all([
        fetchPortfolioFromApi(),
        fetchTaxProfileFromApi(),
      ]);
      setHoldings(loadedHoldings);
      setTaxProfile(loadedTaxProfile);
      setShowTaxModal(!loadedTaxProfile);
      setIsReady(true);
    }
    loadData().catch(() => {
      setIsReady(true);
      setShowTaxModal(true);
    });
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => undefined);
    }
  }, []);

  const symbolsQuery = useQuery({ queryKey: ['portfolio-symbols'], queryFn: fetchSymbols, refetchOnWindowFocus: false });
  const holdingSymbols = useMemo(() => holdings.map((h) => h.symbol), [holdings]);
  const holdingsQuery = useQuery({ queryKey: ['portfolio-holdings-data', holdingSymbols], queryFn: () => fetchHoldings(holdingSymbols), enabled: holdingSymbols.length > 0, refetchInterval: isMarketOpen ? 10_000 : false, refetchOnWindowFocus: isMarketOpen });
  const dataLookup = useMemo(() => new Map((holdingsQuery.data?.items ?? []).map((item) => [item.symbol, item])), [holdingsQuery.data?.items]);

  const rows = useMemo(() => {
    const filerStatus = taxProfile?.filerStatus ?? 'filer';
    return holdings.map((holding) => {
      const data = dataLookup.get(holding.symbol);
      const currentPrice = data?.tick?.price ?? 0;
      const buyDate = parseDate(holding.buyDate);
      const qualifyingDividends = (data?.dividends ?? []).filter((div) => { const exDate = parseDate(div.ex_date); return Boolean(buyDate && exDate && exDate >= buyDate); });
      const dividendTotals = qualifyingDividends.reduce((totals, div) => {
        const gross = holding.shares * div.amount;
        const tax = calculateDividendTax(gross, filerStatus);
        return { gross: totals.gross + tax.grossDividend, wht: totals.wht + tax.whtAmount, net: totals.net + tax.netDividend, whtRate: tax.whtRate };
      }, { gross: 0, wht: 0, net: 0, whtRate: filerStatus === 'filer' ? 0.15 : 0.30 });
      const dripShares = holding.drip && currentPrice > 0 ? dividendTotals.net / currentPrice : 0;
      const effectiveShares = holding.shares + dripShares;
      const invested = holding.shares * holding.avgBuyPrice;
      const currentValue = effectiveShares * currentPrice;
      const pnl = (currentPrice - holding.avgBuyPrice) * effectiveShares;
      const returnPercent = holding.avgBuyPrice > 0 ? (currentPrice - holding.avgBuyPrice) / holding.avgBuyPrice : 0;
      const priceChangeFromBuy = holding.avgBuyPrice > 0 ? ((currentPrice - holding.avgBuyPrice) / holding.avgBuyPrice) * 100 : 0;
      return { holding, data, currentPrice, qualifyingDividends, dividendTotals, dripShares, effectiveShares, invested, currentValue, pnl, returnPercent, priceChangeFromBuy };
    });
  }, [dataLookup, holdings, taxProfile?.filerStatus]);

  useEffect(() => {
    const nextFlashes: Record<string, 'up' | 'down'> = {};
    for (const row of rows) {
      if (!row.currentPrice) continue;
      const prev = previousPricesRef.current.get(row.holding.symbol);
      if (prev && prev !== row.currentPrice) nextFlashes[row.holding.symbol] = row.currentPrice > prev ? 'up' : 'down';
      previousPricesRef.current.set(row.holding.symbol, row.currentPrice);
    }
    if (Object.keys(nextFlashes).length > 0) { setPriceFlashes(nextFlashes); window.setTimeout(() => setPriceFlashes({}), 1600); }
  }, [holdingsQuery.data?.updatedAt, rows]);

  useEffect(() => {
    for (const row of rows) {
      if (!row.currentPrice || (row.priceChangeFromBuy < 5 && row.priceChangeFromBuy > -5)) continue;
      const direction = row.priceChangeFromBuy >= 5 ? 'up' : 'down';
      const key = `${row.holding.symbol}-${direction}-5`;
      if (notifiedRef.current.has(key)) continue;
      notifiedRef.current.add(key);
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(`${direction === 'up' ? '🟢' : '🔴'} ${row.holding.symbol} ${direction} ${Math.abs(row.priceChangeFromBuy).toFixed(1)}% from buy price`, { body: `Now ${money(row.currentPrice)} vs avg ${money(row.holding.avgBuyPrice)}` });
      }
    }
  }, [rows]);

  const summary = useMemo(() => {
    const totals = rows.reduce((result, row) => ({ invested: result.invested + row.invested, currentValue: result.currentValue + row.currentValue, grossDividends: result.grossDividends + row.dividendTotals.gross, wht: result.wht + row.dividendTotals.wht, netDividends: result.netDividends + row.dividendTotals.net, dripShares: result.dripShares + row.dripShares }), { invested: 0, currentValue: 0, grossDividends: 0, wht: 0, netDividends: 0, dripShares: 0 });
    const pnl = totals.currentValue - totals.invested;
    const pnlPercent = totals.invested > 0 ? pnl / totals.invested : 0;
    const capitalGainsTax = calculateCapitalGainsTax(pnl, taxProfile?.filerStatus ?? 'filer');
    return { ...totals, pnl, pnlPercent, capitalGainsTax };
  }, [rows, taxProfile?.filerStatus]);

  async function saveHoldings(next: Holding[]) {
    setHoldings(next);
    setIsSaving(true);
    try {
      await savePortfolioToApi(next);
    } catch {
      showToast('Could not save positions — please try again.');
    } finally {
      setIsSaving(false);
    }
  }

  function completeAdd(holding: Holding, toastPrice: number) {
    const exists = holdings.some((h) => h.symbol === holding.symbol);
    if (exists) { setPendingHolding({ holding, toastPrice }); return; }
    saveHoldings(upsertHolding(holdings, holding));
    showToast(`${holding.symbol} added - ${holding.shares} shares @ ${money(toastPrice)}`);
  }
  function confirmPendingAdd() {
    if (!pendingHolding) return;
    saveHoldings(upsertHolding(holdings, pendingHolding.holding));
    showToast(`${pendingHolding.holding.symbol} added - ${pendingHolding.holding.shares} shares @ ${money(pendingHolding.toastPrice)}`);
    setPendingHolding(null);
  }
  function showToast(message: string) { setToast(message); window.setTimeout(() => setToast(''), 3500); }
  async function updateTaxProfile(profile: TaxProfile) {
    setTaxProfile(profile);
    setShowTaxModal(false);
    try {
      await saveTaxProfileToApi(profile);
    } catch {
      showToast('Could not save tax profile — please try again.');
    }
  }
  function editHolding(holding: Holding) {
    const shares = window.prompt('Update shares', String(holding.shares));
    if (!shares) return;
    const price = window.prompt('Update average buy price', String(holding.avgBuyPrice));
    if (!price) return;
    const parsedShares = Number(shares); const parsedPrice = Number(price);
    if (!Number.isFinite(parsedShares) || parsedShares <= 0 || !Number.isFinite(parsedPrice) || parsedPrice <= 0) { showToast('Enter valid shares and price.'); return; }
    saveHoldings(holdings.map((h) => h.symbol === holding.symbol ? { ...h, shares: parsedShares, avgBuyPrice: parsedPrice } : h));
    showToast(`${holding.symbol} updated.`);
  }
  function removeHolding(symbol: string) {
    if (!window.confirm(`Remove ${symbol} from your portfolio?`)) return;
    saveHoldings(holdings.filter((h) => h.symbol !== symbol));
    showToast(`${symbol} removed.`);
  }

  function handleImportKey(key: string): boolean {
    return setPortfolioKey(key);
  }

  const pendingExisting = pendingHolding ? holdings.find((h) => h.symbol === pendingHolding.holding.symbol) : undefined;
  const pendingAvg = pendingExisting && pendingHolding ? ((pendingExisting.shares * pendingExisting.avgBuyPrice) + (pendingHolding.holding.avgBuyPrice * pendingHolding.holding.shares)) / (pendingExisting.shares + pendingHolding.holding.shares) : 0;
  const hasDrip = holdings.some((h) => h.drip);
  const symbols = symbolsQuery.data?.symbols ?? [];
  const filerStatus = taxProfile?.filerStatus ?? 'filer';

  return (
    <main className="min-h-[calc(100vh-120px)] px-4 py-8 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-line pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="font-mono text-[10px] text-coral tracking-widest">004 // PORTFOLIO</span>
            <h1 className="mt-2 font-display text-4xl tracking-wide text-white lg:text-6xl">PORTFOLIO TRACKER</h1>
            <p className="mt-3 max-w-2xl font-mono text-xs uppercase tracking-wider leading-relaxed text-gray-500">// HOLDINGS · DIVIDENDS · WHT · DRIP · ALERTS · CLOUD-PERSISTED</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {isSaving ? <span className="text-xs text-gray-500">Saving&hellip;</span> : null}
            <div className={`rounded border px-4 py-2 text-sm font-medium ${isMarketOpen ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' : 'border-rose-400/30 bg-rose-400/10 text-rose-200'}`}>
              {marketStatusQuery.data?.label ?? 'Checking market status'}
            </div>
            <button type="button" onClick={() => setShowTaxModal(true)} className="rounded border border-line bg-panel px-4 py-2 text-sm font-medium text-gray-200 transition hover:border-coral/60 hover:text-coral">
              Update Tax Profile
            </button>
            <button
              type="button"
              onClick={() => setShowReviewModal(true)}
              disabled={holdings.length === 0}
              className="flex items-center gap-2 rounded border border-coral/60 bg-coral/15 px-4 py-2 text-sm font-semibold text-coral transition hover:bg-coral/25 disabled:opacity-50"
            >
              <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
              Review my portfolio
            </button>
          </div>
        </header>

        {portfolioKey ? <PortfolioKeyPanel portfolioKey={portfolioKey} onImport={handleImportKey} /> : null}

        <AddPositionCard symbols={symbols} holdings={holdings} onAdd={completeAdd} />

        {holdings.length > 0 ? (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <StatCard label="Total Invested" value={money(summary.invested)} />
              <StatCard label="Current Value" value={money(summary.currentValue)} />
              <StatCard label="Total P&L" value={money(summary.pnl)} subtext={ratioPercent(summary.pnlPercent)} tone={summary.pnl >= 0 ? 'text-emerald-300' : 'text-rose-300'} />
              <StatCard label="Gross Dividends" value={money(summary.grossDividends)} />
              <StatCard label="WHT Deducted" value={money(summary.wht)} tone="text-amber-300" />
              <StatCard label="Net Dividends" value={money(summary.netDividends)} />
              {hasDrip ? <StatCard label="DRIP Shares Added" value={commaNumber(summary.dripShares)} /> : null}
            </section>

            <div className="rounded border border-line bg-panel p-4 text-sm leading-6 text-gray-400">
              Estimated capital gains WHT on current unrealized gains: <span className="text-gray-200">{money(summary.capitalGainsTax.cgtAmount)}</span> at 15%.
              {filerStatus === 'non-filer' ? ' Non-filers may owe more depending on their income slab.' : ''}
            </div>

            <section className="rounded border border-line bg-panel p-5">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Holdings</h2>
                  <p className="mt-1 text-sm text-gray-500">{isMarketOpen ? 'Live prices refresh every 10 seconds.' : 'Market is closed - price refresh is paused.'}</p>
                </div>
                <p className="text-sm text-gray-500">{holdingsQuery.isFetching ? 'Refreshing' : holdingsQuery.data?.updatedAt ? `Last updated ${new Date(holdingsQuery.data.updatedAt).toLocaleTimeString()}` : ''}</p>
              </div>
              {holdingsQuery.error ? <div className="mt-4 rounded border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-100">{holdingsQuery.error instanceof Error ? holdingsQuery.error.message : 'Unable to load holdings.'}</div> : null}
              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[1220px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs uppercase text-gray-500">
                      {['Symbol', 'Position', 'Avg Buy Price', 'Current Price', 'P&L', 'Current Value', 'Dividends', 'Fundamentals', 'Alert', 'Actions'].map((col) => (
                        <th key={col} className="px-4 py-3 font-medium first:pl-0 last:pr-0">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const isPositive = row.pnl >= 0;
                      const alertDirection = row.priceChangeFromBuy >= 5 ? 'up' : row.priceChangeFromBuy <= -5 ? 'down' : null;
                      const flash = priceFlashes[row.holding.symbol];
                      const dividendOpen = expandedSymbol === row.holding.symbol;
                      return (
                        <Fragment key={row.holding.symbol}>
                          <tr className={`border-b border-line/80 transition ${alertDirection === 'up' ? 'bg-emerald-400/[0.06]' : alertDirection === 'down' ? 'bg-rose-400/[0.06]' : 'hover:bg-white/[0.03]'}`}>
                            <td className="py-4 pr-4 align-top">
                              <p className="font-semibold text-coral">{row.holding.symbol}</p>
                              <p className="mt-1 text-xs text-gray-500">{row.data?.fundamentals?.sector ?? 'Sector unavailable'}</p>
                            </td>
                            <td className="px-4 py-4 align-top text-gray-300">
                              <p>{commaNumber(row.holding.shares)} base</p>
                              {row.holding.drip ? <p className="mt-1 text-xs text-emerald-300">+ {commaNumber(row.dripShares)} reinvested shares</p> : null}
                              <p className="mt-1 font-semibold text-white">{commaNumber(row.effectiveShares)} total</p>
                            </td>
                            <td className="px-4 py-4 align-top text-gray-300">{money(row.holding.avgBuyPrice)}</td>
                            <td className="px-4 py-4 align-top">
                              <p className={`font-semibold ${flash === 'up' ? 'text-emerald-200' : flash === 'down' ? 'text-rose-200' : 'text-white'}`}>{row.currentPrice ? money(row.currentPrice) : '--'}</p>
                              <p className={`mt-1 text-xs ${(row.data?.tick?.changePercent ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{row.data?.tick ? ratioPercent(row.data.tick.changePercent) : '--'}</p>
                            </td>
                            <td className="px-4 py-4 align-top">
                              <p className={`font-semibold ${isPositive ? 'text-emerald-300' : 'text-rose-300'}`}>{money(row.pnl)}</p>
                              <p className={`mt-1 text-xs ${isPositive ? 'text-emerald-300' : 'text-rose-300'}`}>{ratioPercent(row.returnPercent)}</p>
                            </td>
                            <td className="px-4 py-4 align-top text-gray-300">{money(row.currentValue)}</td>
                            <td className="px-4 py-4 align-top">
                              <button type="button" onClick={() => setExpandedSymbol(dividendOpen ? '' : row.holding.symbol)} className="flex items-center gap-2 text-left text-gray-300 hover:text-coral">
                                <span>{money(row.dividendTotals.net)} net</span>
                                <span className="rounded border border-amber-300/30 bg-amber-400/10 px-2 py-0.5 text-xs text-amber-200">{Math.round(row.dividendTotals.whtRate * 100)}% WHT</span>
                                {dividendOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              </button>
                            </td>
                            <td className="px-4 py-4 align-top text-gray-300">
                              <p>P/E {row.data?.fundamentals ? commaNumber(row.data.fundamentals.peRatio) : '--'}</p>
                              <p className="mt-1 text-xs text-gray-500">Yield {row.data?.fundamentals ? plainPercent(row.data.fundamentals.dividendYield) : '--'}</p>
                            </td>
                            <td className="px-4 py-4 align-top">
                              {alertDirection ? (
                                <span className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-semibold ${alertDirection === 'up' ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' : 'border-rose-400/30 bg-rose-400/10 text-rose-200'}`}>
                                  <Bell className="h-3.5 w-3.5" />
                                  {alertDirection === 'up' ? '+' : '-'}{Math.abs(row.priceChangeFromBuy).toFixed(1)}%
                                </span>
                              ) : <span className="text-gray-600">--</span>}
                            </td>
                            <td className="py-4 pl-4 align-top">
                              <div className="flex gap-2">
                                <button type="button" onClick={() => editHolding(row.holding)} className="rounded border border-line p-2 text-gray-400 transition hover:text-coral" aria-label={`Edit ${row.holding.symbol}`}><Pencil className="h-4 w-4" /></button>
                                <button type="button" onClick={() => removeHolding(row.holding.symbol)} className="rounded border border-line p-2 text-gray-400 transition hover:text-rose-200" aria-label={`Remove ${row.holding.symbol}`}><Trash2 className="h-4 w-4" /></button>
                              </div>
                            </td>
                          </tr>
                          {dividendOpen ? (
                            <tr className="border-b border-line/80 bg-black/15">
                              <td colSpan={10} className="px-4 py-4">
                                <div className="grid gap-3 text-sm sm:grid-cols-4">
                                  <StatCard label="Gross earned since buy date" value={money(row.dividendTotals.gross)} />
                                  <StatCard label="WHT deducted" value={money(row.dividendTotals.wht)} tone="text-amber-300" />
                                  <StatCard label="Net received" value={money(row.dividendTotals.net)} />
                                  <StatCard label={row.holding.drip ? 'Reinvested' : 'Cash dividends'} value={row.holding.drip ? `${commaNumber(row.dripShares)} shares added` : 'Not reinvested'} />
                                </div>
                                <p className="mt-3 text-xs text-gray-500">{row.qualifyingDividends.length} dividend entries counted from {row.holding.buyDate}.</p>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : isReady ? <EmptyState /> : null}

        <footer className="rounded border border-line bg-panel p-4 text-xs leading-5 text-gray-500">
          Dividend WHT rates: 15% (filer) / 30% (non-filer) for standard company dividends under Pakistan's Income Tax Ordinance. Capital gains on listed securities: 15% (filer). Rates sourced from PwC Tax Summaries, last reviewed January 2026. This tool is for reference only and does not constitute tax or financial advice.
        </footer>
      </div>

      {showTaxModal ? <TaxProfileModal initialStatus={taxProfile?.filerStatus ?? 'filer'} onSave={updateTaxProfile} onClose={() => setShowTaxModal(false)} mustChoose={!taxProfile} /> : null}

      {pendingHolding && pendingExisting ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 px-4">
          <div className="w-full max-w-lg rounded border border-line bg-panel p-6 shadow-2xl">
            <h2 className="text-xl font-semibold text-white">Average Existing Position</h2>
            <p className="mt-2 text-sm text-gray-400">{pendingHolding.holding.symbol} already exists. Confirm to combine the positions.</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <StatCard label="Existing avg" value={money(pendingExisting.avgBuyPrice)} />
              <StatCard label="New buy price" value={money(pendingHolding.holding.avgBuyPrice)} />
              <StatCard label="New average" value={money(pendingAvg)} tone="text-coral" />
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setPendingHolding(null)} className="rounded border border-line px-4 py-2 text-sm text-gray-300 transition hover:text-white">Cancel</button>
              <button type="button" onClick={confirmPendingAdd} className="rounded border border-coral/60 bg-coral/15 px-4 py-2 text-sm font-semibold text-coral transition hover:bg-coral/25">Confirm Add</button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? <div className="fixed bottom-5 right-5 z-50 rounded border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100 shadow-xl">{toast}</div> : null}

      {showReviewModal ? <PortfolioReviewModal onClose={() => setShowReviewModal(false)} /> : null}
    </main>
  );
}
