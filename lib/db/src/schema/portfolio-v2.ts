import { pgTable, serial, text, doublePrecision, boolean, integer, timestamp, index } from "drizzle-orm/pg-core";

export type AcquisitionRegime =
  | 'pre_2013'
  | 'jul13_jun22'
  | 'jul22_jun24'
  | 'jul24_jun25'
  | 'post_jul25';

export type LotSource = 'manual' | 'dividend_reinvest' | 'csv_import';

// One row per purchase. The source of truth for FIFO and CGT calculations.
export const portfolioLots = pgTable(
  "portfolio_lots",
  {
    id: serial("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    symbol: text("symbol").notNull(),
    acquisitionDate: text("acquisition_date").notNull(),       // YYYY-MM-DD
    quantityPurchased: doublePrecision("quantity_purchased").notNull(),
    quantityRemaining: doublePrecision("quantity_remaining").notNull(), // decreases on FIFO sells
    costPerShare: doublePrecision("cost_per_share").notNull(),
    commissionPaid: doublePrecision("commission_paid").notNull().default(0),
    acquisitionRegime: text("acquisition_regime").notNull(),   // AcquisitionRegime
    source: text("source").notNull().default("manual"),        // LotSource
    drip: boolean("drip").notNull().default(false),
    reinvestedFromDividendId: integer("reinvested_from_dividend_id"), // nullable; no FK until dividends table exists
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    sessionSymbolIdx: index("portfolio_lots_session_symbol_idx").on(table.sessionId, table.symbol),
    sessionDateIdx: index("portfolio_lots_session_date_idx").on(table.sessionId, table.acquisitionDate),
  }),
);

// One row per FIFO partial-sell. References the lot it drew from.
export const portfolioDisposals = pgTable(
  "portfolio_disposals",
  {
    id: serial("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    lotId: integer("lot_id").notNull().references(() => portfolioLots.id),
    saleDate: text("sale_date").notNull(),                     // YYYY-MM-DD
    quantitySold: doublePrecision("quantity_sold").notNull(),
    salePricePerShare: doublePrecision("sale_price_per_share").notNull(),
    saleCommission: doublePrecision("sale_commission").notNull().default(0),
    // All three fields computed at write time using NCCPL 0.5% standard expense
    costBasis: doublePrecision("cost_basis").notNull(),
    proceeds: doublePrecision("proceeds").notNull(),
    realizedGain: doublePrecision("realized_gain").notNull(),
    holdingPeriodDays: integer("holding_period_days").notNull(),
    cgtRateApplied: doublePrecision("cgt_rate_applied").notNull(),
    cgtAmount: doublePrecision("cgt_amount").notNull(),
    fiscalYear: text("fiscal_year").notNull(),                 // e.g. 'FY26'
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    sessionFyIdx: index("portfolio_disposals_session_fy_idx").on(table.sessionId, table.fiscalYear),
  }),
);

// Versioned CGT rate schedule. Never hardcoded — engine reads this table.
// Update rows (or insert new effective_from rows) when SROs change rates.
export const cgtRateConfig = pgTable("cgt_rate_config", {
  id: serial("id").primaryKey(),
  effectiveFrom: text("effective_from").notNull(),             // YYYY-MM-DD
  effectiveTo: text("effective_to"),                           // null = currently active
  acquisitionRegime: text("acquisition_regime").notNull(),     // AcquisitionRegime
  holdingMinDays: integer("holding_min_days").notNull(),       // inclusive lower bound
  holdingMaxDays: integer("holding_max_days"),                 // null = no upper bound
  filerRate: doublePrecision("filer_rate").notNull(),          // e.g. 0.15 for 15%
  nonFilerRate: doublePrecision("non_filer_rate").notNull(),
  sourceUrl: text("source_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type PortfolioLot = typeof portfolioLots.$inferSelect;
export type NewPortfolioLot = typeof portfolioLots.$inferInsert;
export type PortfolioDisposal = typeof portfolioDisposals.$inferSelect;
export type NewPortfolioDisposal = typeof portfolioDisposals.$inferInsert;
export type CgtRateConfig = typeof cgtRateConfig.$inferSelect;
