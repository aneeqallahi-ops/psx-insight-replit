import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Info, Layers } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { useMarketStatus } from '@/hooks/useMarketStatus';
import { fetchLotsSnapshot, REGIME_LABELS } from '@/lib/portfolio';
import type { LotSnapshot } from '@/lib/portfolio';

function money(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '--';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, style: 'currency', currency: 'PKR' }).format(value);
}
function commaNumber(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0);
}
function ratioPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '--';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, style: 'percent' }).format(value);
}
function rateAsPercent(value: number) {
  return `${(value * 100).toFixed(2).replace(/\.?0+$/, '')}%`;
}
function fmtDays(days: number) {
  if (days < 0) return '--';
  if (days < 60) return `${days}d`;
  if (days < 730) return `${Math.floor(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

interface SymbolGroup {
  symbol: string;
  lots: LotSnapshot[];
  totalQuantity: number;
  totalInvested: number;
  totalCurrentValue: number;
  totalUnrealized: number;
  totalProjectedCgt: number;
  hasMissingPrice: boolean;
}

function groupBySymbol(lots: LotSnapshot[]): SymbolGroup[] {
  const map = new Map<string, SymbolGroup>();
  for (const lot of lots) {
    if (lot.quantityRemaining <= 0) continue;
    let group = map.get(lot.symbol);
    if (!group) {
      group = {
        symbol: lot.symbol,
        lots: [],
        totalQuantity: 0,
        totalInvested: 0,
        totalCurrentValue: 0,
        totalUnrealized: 0,
        totalProjectedCgt: 0,
        hasMissingPrice: false,
      };
      map.set(lot.symbol, group);
    }
    group.lots.push(lot);
    group.totalQuantity += lot.quantityRemaining;
    group.totalInvested += lot.quantityRemaining * lot.costPerShare;
    if (lot.currentValue !== null) group.totalCurrentValue += lot.currentValue;
    if (lot.unrealizedGain !== null) group.totalUnrealized += lot.unrealizedGain;
    if (lot.projectedCgtIfSoldToday !== null) group.totalProjectedCgt += lot.projectedCgtIfSoldToday;
    if (lot.currentPrice === null) group.hasMissingPrice = true;
  }
  for (const group of map.values()) {
    group.lots.sort((a, b) => a.acquisitionDate.localeCompare(b.acquisitionDate));
  }
  return Array.from(map.values()).sort((a, b) => b.totalCurrentValue - a.totalCurrentValue);
}

export function LotView() {
  const marketStatusQuery = useMarketStatus();
  const isMarketOpen = marketStatusQuery.data?.isOpen ?? false;
  const snapshotQuery = useQuery({
    queryKey: ['portfolio-lots-snapshot'],
    queryFn: fetchLotsSnapshot,
    refetchInterval: isMarketOpen ? 15_000 : false,
    refetchOnWindowFocus: isMarketOpen,
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => groupBySymbol(snapshotQuery.data?.lots ?? []), [snapshotQuery.data?.lots]);
  const totals = useMemo(() => {
    return groups.reduce(
      (acc, g) => ({
        invested: acc.invested + g.totalInvested,
        currentValue: acc.currentValue + g.totalCurrentValue,
        unrealized: acc.unrealized + g.totalUnrealized,
        projectedCgt: acc.projectedCgt + g.totalProjectedCgt,
      }),
      { invested: 0, currentValue: 0, unrealized: 0, projectedCgt: 0 },
    );
  }, [groups]);

  if (snapshotQuery.isLoading) {
    return <div className="rounded border border-line bg-panel p-6 text-sm text-gray-500">Loading lots&hellip;</div>;
  }

  if (snapshotQuery.error) {
    const message = snapshotQuery.error instanceof Error ? snapshotQuery.error.message : 'Failed to load lots.';
    return (
      <div className="rounded border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-100">{message}</div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="grid place-items-center rounded border border-dashed border-line bg-panel px-6 py-16 text-center">
        <Layers className="h-10 w-10 text-coral" aria-hidden="true" />
        <h2 className="mt-4 text-xl font-semibold text-white">No lots yet</h2>
        <p className="mt-2 max-w-md text-sm text-gray-500">Add positions on the Add Position card above. Each purchase becomes a lot for accurate FIFO/CGT tracking.</p>
      </div>
    );
  }

  const filerStatus = snapshotQuery.data?.filerStatus ?? 'filer';
  const showBackfillNotice = Boolean(snapshotQuery.data?.notice);

  return (
    <div className="flex flex-col gap-4">
      {showBackfillNotice ? (
        <div className="flex items-start gap-3 rounded border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{snapshotQuery.data!.notice}</p>
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Invested (cost)" value={money(totals.invested)} />
        <SummaryCard label="Current Value" value={money(totals.currentValue)} />
        <SummaryCard
          label="Unrealized Gain"
          value={money(totals.unrealized)}
          subtext={ratioPercent(totals.invested > 0 ? totals.unrealized / totals.invested : 0)}
          tone={totals.unrealized >= 0 ? 'text-emerald-300' : 'text-rose-300'}
        />
        <SummaryCard
          label="Projected CGT if sold today"
          value={money(totals.projectedCgt)}
          subtext={`Filer: ${filerStatus === 'filer' ? 'ATL' : 'Non-filer'} · uses NCCPL 0.5%`}
          tone="text-amber-300"
        />
      </section>

      <section className="rounded border border-line bg-panel p-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Lots by symbol</h2>
            <p className="mt-1 text-sm text-gray-500">
              {isMarketOpen ? 'Live prices refresh every 15 seconds.' : 'Market is closed - prices are last-traded.'}
            </p>
          </div>
          <p className="text-sm text-gray-500">
            {snapshotQuery.isFetching ? 'Refreshing' : snapshotQuery.data?.asOf ? `Last updated ${new Date(snapshotQuery.data.asOf).toLocaleTimeString()}` : ''}
          </p>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase text-gray-500">
                <th className="px-3 py-3 font-medium first:pl-0">Symbol / Lot</th>
                <th className="px-3 py-3 font-medium">Acquired</th>
                <th className="px-3 py-3 font-medium">Regime</th>
                <th className="px-3 py-3 font-medium">Held</th>
                <th className="px-3 py-3 font-medium">Qty</th>
                <th className="px-3 py-3 font-medium">Cost / Share</th>
                <th className="px-3 py-3 font-medium">Current</th>
                <th className="px-3 py-3 font-medium">Unrealized</th>
                <th className="px-3 py-3 font-medium last:pr-0">CGT if sold</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const isOpen = expanded[group.symbol] ?? true;
                const positiveTotal = group.totalUnrealized >= 0;
                const investedPercent = group.totalInvested > 0 ? group.totalUnrealized / group.totalInvested : 0;
                return (
                  <Fragment key={group.symbol}>
                    <tr className="border-b border-line bg-black/20">
                      <td className="px-3 py-3 first:pl-0">
                        <button
                          type="button"
                          onClick={() => setExpanded((prev) => ({ ...prev, [group.symbol]: !isOpen }))}
                          className="flex items-center gap-2 font-semibold text-coral"
                        >
                          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          {group.symbol}
                          <span className="rounded border border-line bg-black/30 px-2 py-0.5 text-xs font-medium text-gray-400">
                            {group.lots.length} {group.lots.length === 1 ? 'lot' : 'lots'}
                          </span>
                        </button>
                      </td>
                      <td className="px-3 py-3 text-gray-500" colSpan={3}>—</td>
                      <td className="px-3 py-3 font-semibold text-white">{commaNumber(group.totalQuantity)}</td>
                      <td className="px-3 py-3 text-gray-500">—</td>
                      <td className="px-3 py-3 text-white">{group.hasMissingPrice ? '—' : money(group.totalCurrentValue)}</td>
                      <td className={`px-3 py-3 font-semibold ${positiveTotal ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {money(group.totalUnrealized)}
                        <span className="ml-2 text-xs font-normal">{ratioPercent(investedPercent)}</span>
                      </td>
                      <td className="px-3 py-3 last:pr-0 font-semibold text-amber-300">{money(group.totalProjectedCgt)}</td>
                    </tr>

                    {isOpen
                      ? group.lots.map((lot) => {
                          const regime = REGIME_LABELS[lot.acquisitionRegime];
                          const positive = (lot.unrealizedGain ?? 0) >= 0;
                          return (
                            <tr key={lot.id} className="border-b border-line/60 hover:bg-white/[0.03]">
                              <td className="px-3 py-3 first:pl-8 text-gray-300">
                                Lot #{lot.id}
                                {lot.drip ? (
                                  <span className="ml-2 rounded border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] uppercase text-emerald-200">DRIP</span>
                                ) : null}
                              </td>
                              <td className="px-3 py-3 text-gray-300">{lot.acquisitionDate}</td>
                              <td className="px-3 py-3">
                                <span className={`inline-flex rounded border px-2 py-0.5 text-[11px] font-medium ${regime.tone}`} title={regime.label}>
                                  {regime.short}
                                </span>
                              </td>
                              <td className="px-3 py-3 text-gray-400">{fmtDays(lot.holdingDays)}</td>
                              <td className="px-3 py-3 text-gray-200">{commaNumber(lot.quantityRemaining)}</td>
                              <td className="px-3 py-3 text-gray-300">{money(lot.costPerShare)}</td>
                              <td className="px-3 py-3 text-gray-300">
                                {money(lot.currentPrice)}
                                {lot.priceError ? <p className="text-xs text-rose-300">{lot.priceError}</p> : null}
                              </td>
                              <td className={`px-3 py-3 font-medium ${positive ? 'text-emerald-300' : 'text-rose-300'}`}>
                                {money(lot.unrealizedGain)}
                                <span className="ml-2 text-xs font-normal">{ratioPercent(lot.unrealizedGainPercent)}</span>
                              </td>
                              <td className="px-3 py-3 last:pr-0 text-amber-300">
                                {money(lot.projectedCgtIfSoldToday)}
                                <span className="ml-2 text-xs font-normal text-gray-500">@ {rateAsPercent(lot.cgtRateIfSoldToday)}</span>
                              </td>
                            </tr>
                          );
                        })
                      : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-gray-500">
          Projected CGT applies the FY26 rate that would apply if the lot were sold today, after a 0.5% NCCPL standard expense on both buy and sell. Rates are read from <code className="rounded bg-black/30 px-1 py-0.5 text-coral">cgt_rate_config</code> and never hardcoded.
        </p>
      </section>
    </div>
  );
}

function SummaryCard({ label, value, subtext, tone }: { label: string; value: string; subtext?: string; tone?: string }) {
  return (
    <div className="rounded border border-line bg-panel p-4">
      <p className="text-xs uppercase text-gray-500">{label}</p>
      <p className={`mt-2 text-lg font-semibold ${tone ?? 'text-white'}`}>{value}</p>
      {subtext ? <p className="mt-1 text-xs text-gray-500">{subtext}</p> : null}
    </div>
  );
}
