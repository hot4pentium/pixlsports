import { createInsertSchema } from "drizzle-zod";
import { jsonb, pgTable, text, timestamp, integer, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const statTrackerSharesTable = pgTable("stat_tracker_shares", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerClerkUserId: text("owner_clerk_user_id").notNull(),
  gameId: text("game_id").notNull(),
  athleteName: text("athlete_name").notNull(),
  teamName: text("team_name").notNull(),
  game: jsonb("game").notNull(),
  revision: integer("revision").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  ownerGameUnique: uniqueIndex("stat_tracker_shares_owner_game_unique").on(table.ownerClerkUserId, table.gameId),
}));

export const insertStatTrackerShareSchema = createInsertSchema(statTrackerSharesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertStatTrackerShare = z.infer<typeof insertStatTrackerShareSchema>;
export type StatTrackerShare = typeof statTrackerSharesTable.$inferSelect;