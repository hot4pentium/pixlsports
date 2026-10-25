import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const nativeLinkRateLimitsTable = pgTable("native_link_rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetsAt: timestamp("resets_at", { withTimezone: true }).notNull(),
});
export const insertNativeLinkRateLimitSchema = createInsertSchema(nativeLinkRateLimitsTable);
export type NativeLinkRateLimit = typeof nativeLinkRateLimitsTable.$inferSelect;
