import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const supporterActiveGamesTable = pgTable("supporter_active_games", {
  ownerClerkUserId: text("owner_clerk_user_id").primaryKey(),
  gameId: text("game_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type SupporterActiveGame = typeof supporterActiveGamesTable.$inferSelect;