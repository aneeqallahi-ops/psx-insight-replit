import { pgTable, serial, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const agentReports = pgTable(
  "agent_reports",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    payload: jsonb("payload").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    scopeKeyGeneratedIdx: index("agent_reports_scope_key_generated_idx").on(
      table.scope,
      table.key,
      table.generatedAt,
    ),
  }),
);

export type AgentReport = typeof agentReports.$inferSelect;
export type NewAgentReport = typeof agentReports.$inferInsert;
