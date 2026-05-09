import { db } from '@workspace/db';
import { cgtRateConfig } from '@workspace/db/schema';
import { and, lte, gte, or, isNull, eq, count } from 'drizzle-orm';
import type { AcquisitionRegime } from '@workspace/db/schema';

// ---------------------------------------------------------------------------
// Regime detection — which CGT window applies to an acquisition date?
// ---------------------------------------------------------------------------

const REGIME_BOUNDARIES = [
  { from: '2025-07-01', regime: 'post_jul25' as const },
  { from: '2024-07-01', regime: 'jul24_jun25' as const },
  { from: '2022-07-01', regime: 'jul22_jun24' as const },
  { from: '2013-07-01', regime: 'jul13_jun22' as const },
] as const;

export function getAcquisitionRegime(acquisitionDate: string): AcquisitionRegime {
  for (const { from, regime } of REGIME_BOUNDARIES) {
    if (acquisitionDate >= from) return regime;
  }
  return 'pre_2013';
}

// ---------------------------------------------------------------------------
// Fiscal year helpers (Pakistan FY: 1 Jul – 30 Jun)
// ---------------------------------------------------------------------------

export function getFiscalYear(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // 1-based
  const fy = month >= 7 ? year + 1 : year;
  return `FY${String(fy).slice(2)}`;
}

export function fiscalYearStart(fy: string): Date {
  const year = 2000 + parseInt(fy.slice(2), 10) - 1;
  return new Date(`${year}-07-01`);
}

export function fiscalYearEnd(fy: string): Date {
  const year = 2000 + parseInt(fy.slice(2), 10);
  return new Date(`${year}-06-30`);
}

export function daysBetween(from: string | Date, to: string | Date): number {
  const a = typeof from === 'string' ? new Date(from) : from;
  const b = typeof to === 'string' ? new Date(to) : to;
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

// ---------------------------------------------------------------------------
// CGT rate lookup — reads from cgt_rate_config (never hardcoded)
// ---------------------------------------------------------------------------

export async function lookupCgtRate(
  regime: AcquisitionRegime,
  holdingDays: number,
  filerStatus: 'filer' | 'non-filer',
): Promise<number> {
  const rows = await db
    .select()
    .from(cgtRateConfig)
    .where(
      and(
        eq(cgtRateConfig.acquisitionRegime, regime),
        lte(cgtRateConfig.holdingMinDays, holdingDays),
        or(
          isNull(cgtRateConfig.holdingMaxDays),
          gte(cgtRateConfig.holdingMaxDays, holdingDays),
        ),
      ),
    )
    .limit(1);

  if (rows.length === 0) {
    throw new Error(`No CGT rate found for regime=${regime}, holdingDays=${holdingDays}`);
  }

  return filerStatus === 'filer' ? rows[0].filerRate : rows[0].nonFilerRate;
}

// ---------------------------------------------------------------------------
// CGT computation helpers
// ---------------------------------------------------------------------------

const NCCPL_EXPENSE_RATE = 0.005; // 0.5% standard expense deduction

export interface LotCgtProjection {
  costBasis: number;
  proceeds: number;
  gain: number;
  holdingDays: number;
  regime: AcquisitionRegime;
  cgtRate: number;
  cgtAmount: number;
}

export async function projectLotCgt(
  acquisitionDate: string,
  quantityRemaining: number,
  costPerShare: number,
  currentPrice: number,
  filerStatus: 'filer' | 'non-filer',
  asOf = new Date(),
): Promise<LotCgtProjection> {
  const holdingDays = daysBetween(acquisitionDate, asOf);
  const regime = getAcquisitionRegime(acquisitionDate);
  const cgtRate = await lookupCgtRate(regime, holdingDays, filerStatus);

  const proceeds = quantityRemaining * currentPrice * (1 - NCCPL_EXPENSE_RATE);
  const costBasis = quantityRemaining * costPerShare * (1 + NCCPL_EXPENSE_RATE);
  const gain = proceeds - costBasis;
  const cgtAmount = gain > 0 ? gain * cgtRate : 0;

  return { costBasis, proceeds, gain, holdingDays, regime, cgtRate, cgtAmount };
}

// ---------------------------------------------------------------------------
// CGT rate seeder — idempotent; skips if table already populated.
// Seed data for FY26 (Finance Act 2025 + NCCPL rate schedule).
// IMPORTANT: verify bracket values against nccpl.com.pk/cgt before launch,
// especially the jul22_jun24 4–6 year row which has been subject to SROs.
// ---------------------------------------------------------------------------

const CGT_RATES_FY26 = [
  // pre_2013 — permanently exempt
  {
    effectiveFrom: '2025-07-01', effectiveTo: null,
    acquisitionRegime: 'pre_2013',
    holdingMinDays: 0, holdingMaxDays: null,
    filerRate: 0, nonFilerRate: 0,
    sourceUrl: 'https://nccpl.com.pk/cgt',
    notes: 'Acquisitions before 1 Jul 2013: permanently exempt from CGT.',
  },

  // jul13_jun22 — flat 12.5% / 25%
  {
    effectiveFrom: '2025-07-01', effectiveTo: null,
    acquisitionRegime: 'jul13_jun22',
    holdingMinDays: 0, holdingMaxDays: null,
    filerRate: 0.125, nonFilerRate: 0.25,
    sourceUrl: 'https://nccpl.com.pk/cgt',
    notes: '1 Jul 2013 – 30 Jun 2022: flat rate regardless of holding period.',
  },

  // jul22_jun24 — holding-period progressive, 0% after 6 years
  {
    effectiveFrom: '2025-07-01', effectiveTo: null,
    acquisitionRegime: 'jul22_jun24',
    holdingMinDays: 0, holdingMaxDays: 364,
    filerRate: 0.15, nonFilerRate: 0.30,
    sourceUrl: 'https://nccpl.com.pk/cgt',
    notes: '< 1 year.',
  },
  {
    effectiveFrom: '2025-07-01', effectiveTo: null,
    acquisitionRegime: 'jul22_jun24',
    holdingMinDays: 365, holdingMaxDays: 729,
    filerRate: 0.125, nonFilerRate: 0.25,
    sourceUrl: 'https://nccpl.com.pk/cgt',
    notes: '1–2 years.',
  },
  {
    effectiveFrom: '2025-07-01', effectiveTo: null,
    acquisitionRegime: 'jul22_jun24',
    holdingMinDays: 730, holdingMaxDays: 1094,
    filerRate: 0.10, nonFilerRate: 0.20,
    sourceUrl: 'https://nccpl.com.pk/cgt',
    notes: '2–3 years.',
  },
  {
    effectiveFrom: '2025-07-01', effectiveTo: null,
    acquisitionRegime: 'jul22_jun24',
    holdingMinDays: 1095, holdingMaxDays: 1459,
    filerRate: 0.075, nonFilerRate: 0.15,
    sourceUrl: 'https://nccpl.com.pk/cgt',
    notes: '3–4 years.',
  },
  {
    effectiveFrom: '2025-07-01', effectiveTo: null,
    acquisitionRegime: 'jul22_jun24',
    holdingMinDays: 1460, holdingMaxDays: 2189,
    filerRate: 0.025, nonFilerRate: 0.05,
    sourceUrl: 'https://nccpl.com.pk/cgt',
    notes: '4–6 years. PRD note: "0%–5% (verify)" — using 2.5%/5% estimate. Confirm against NCCPL rate sheet before launch.',
  },
  {
    effectiveFrom: '2025-07-01', effectiveTo: null,
    acquisitionRegime: 'jul22_jun24',
    holdingMinDays: 2190, holdingMaxDays: null,
    filerRate: 0, nonFilerRate: 0,
    sourceUrl: 'https://nccpl.com.pk/cgt',
    notes: '> 6 years: exempt.',
  },

  // jul24_jun25 — 2-bracket progressive
  {
    effectiveFrom: '2025-07-01', effectiveTo: null,
    acquisitionRegime: 'jul24_jun25',
    holdingMinDays: 0, holdingMaxDays: 364,
    filerRate: 0.15, nonFilerRate: 0.30,
    sourceUrl: 'https://nccpl.com.pk/cgt',
    notes: '< 1 year. Finance Act 2025 — verify exact breakpoints.',
  },
  {
    effectiveFrom: '2025-07-01', effectiveTo: null,
    acquisitionRegime: 'jul24_jun25',
    holdingMinDays: 365, holdingMaxDays: null,
    filerRate: 0.075, nonFilerRate: 0.15,
    sourceUrl: 'https://nccpl.com.pk/cgt',
    notes: '>= 1 year. 15%→7.5% filer, 30%→15% non-filer.',
  },

  // post_jul25 — flat 15% regardless of holding period or ATL status
  {
    effectiveFrom: '2025-07-01', effectiveTo: null,
    acquisitionRegime: 'post_jul25',
    holdingMinDays: 0, holdingMaxDays: null,
    filerRate: 0.15, nonFilerRate: 0.15,
    sourceUrl: 'https://nccpl.com.pk/cgt',
    notes: 'On/after 1 Jul 2025: flat 15% for all sellers. Finance Act 2025.',
  },
] as const;

let _seeded = false;

export async function seedCgtRates(): Promise<void> {
  if (_seeded) return;
  _seeded = true;

  const [{ value: existing }] = await db
    .select({ value: count() })
    .from(cgtRateConfig);

  if (Number(existing) > 0) return; // already seeded

  await db.insert(cgtRateConfig).values(
    CGT_RATES_FY26.map((r) => ({
      ...r,
      effectiveTo: r.effectiveTo ?? null,
      holdingMaxDays: r.holdingMaxDays ?? null,
    })),
  );
}
