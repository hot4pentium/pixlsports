import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { athleteInvitesTable } from "./athleteInvites";

/** Durable aggregates survive expiring tracker shares; no fan identity or QR credentials. */
export const athleteLiveTapCompletionsTable = pgTable("athlete_live_tap_completions", {
  id: uuid("id").defaultRandom().primaryKey(),
  inviteId: uuid("invite_id").notNull().references(() => athleteInvitesTable.id, { onDelete: "cascade" }),
  gameId: text("game_id").notNull(),
  seasonKey: text("season_key").notNull(),
  eventId: text("event_id"),
  athleteName: text("athlete_name").notNull(),
  eventTitle: text("event_title").notNull(),
  sport: text("sport").notNull(),
  cheers: jsonb("cheers").notNull().$type<Array<{ key: string; label: string; emoji: string; count: number }>>(),
  endedAt: timestamp("ended_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  gameUnique: uniqueIndex("athlete_cheer_completion_game_unique").on(table.inviteId, table.seasonKey, table.gameId),
}));
