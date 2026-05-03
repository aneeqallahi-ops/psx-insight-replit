import { pgTable, serial, text, integer, doublePrecision, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const portfolioHoldings = pgTable("portfolio_holdings", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  symbol: text("symbol").notNull(),
  shares: doublePrecision("shares").notNull(),
  avgBuyPrice: doublePrecision("avg_buy_price").notNull(),
  buyDate: text("buy_date").notNull(),
  drip: boolean("drip").notNull().default(false),
  addedAt: text("added_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const taxProfiles = pgTable("tax_profiles", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull().unique(),
  filerStatus: text("filer_status").notNull(),
  setAt: text("set_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPortfolioHoldingSchema = createInsertSchema(portfolioHoldings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPortfolioHolding = z.infer<typeof insertPortfolioHoldingSchema>;
export type PortfolioHolding = typeof portfolioHoldings.$inferSelect;

export const insertTaxProfileSchema = createInsertSchema(taxProfiles).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTaxProfile = z.infer<typeof insertTaxProfileSchema>;
export type TaxProfile = typeof taxProfiles.$inferSelect;

export * from "./agent-reports";
export * from "./notifications";
