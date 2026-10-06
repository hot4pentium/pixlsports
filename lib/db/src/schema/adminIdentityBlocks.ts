import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const adminIdentityBlocksTable = pgTable("admin_identity_blocks", {
  clerkUserId: text("clerk_user_id").primaryKey(),
  blockedByClerkUserId: text("blocked_by_clerk_user_id").notNull(),
  reason: text("reason").notNull(),
  blockedAt: timestamp("blocked_at", { withTimezone: true }).notNull().defaultNow(),
});
