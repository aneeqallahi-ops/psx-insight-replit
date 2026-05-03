import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const notificationPreferences = pgTable("notification_preferences", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull().unique(),
  // Empty array = all categories. Otherwise only listed categories trigger alerts.
  categories: jsonb("categories").$type<string[]>().notNull().default([]),
  email: text("email"),
  emailEnabled: boolean("email_enabled").notNull().default(false),
  inAppEnabled: boolean("in_app_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    announcementId: integer("announcement_id").notNull(),
    symbol: text("symbol").notNull(),
    category: text("category").notNull(),
    title: text("title").notNull(),
    announcementDate: text("announcement_date"),
    payload: jsonb("payload").notNull(),
    emailSent: boolean("email_sent").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => ({
    sessionAnnouncementUnique: uniqueIndex("notifications_session_announcement_unique").on(
      table.sessionId,
      table.announcementId,
    ),
    sessionCreatedIdx: index("notifications_session_created_idx").on(
      table.sessionId,
      table.createdAt,
    ),
  }),
);

// Tracks the highest announcement ID we've already processed per symbol so we don't
// resurface old announcements to brand-new portfolios or on every scheduler tick.
export const notificationCursors = pgTable("notification_cursors", {
  symbol: text("symbol").primaryKey(),
  lastAnnouncementId: integer("last_announcement_id").notNull().default(0),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }).defaultNow().notNull(),
});

export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type NotificationCursor = typeof notificationCursors.$inferSelect;
