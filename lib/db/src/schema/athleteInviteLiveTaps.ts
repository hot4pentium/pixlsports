import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { athleteInvitesTable } from "./athleteInvites";

export const athleteInviteLiveTapAccessLinksTable = pgTable("athlete_invite_live_tap_access_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  inviteId: uuid("invite_id").notNull().references(() => athleteInvitesTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => ({
  inviteCreatedIndex: index("athlete_live_tap_access_invite_created_index").on(table.inviteId, table.createdAt),
  tokenHashUnique: uniqueIndex("athlete_live_tap_access_token_hash_unique").on(table.tokenHash),
}));

export const athleteInviteLiveTapsTable = pgTable("athlete_invite_live_taps", {
  id: uuid("id").defaultRandom().primaryKey(),
  inviteId: uuid("invite_id").notNull().references(() => athleteInvitesTable.id, { onDelete: "cascade" }),
  seasonId: uuid("season_id"),
  seasonName: text("season_name"),
  gameId: text("game_id").notNull(),
  cheerKey: text("cheer_key").notNull(),
  accessLinkId: uuid("access_link_id").references(() => athleteInviteLiveTapAccessLinksTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  inviteGameIndex: index("athlete_live_taps_invite_game_created_index").on(table.inviteId, table.gameId, table.createdAt),
  accessLinkIndex: index("athlete_live_taps_access_link_created_index").on(table.accessLinkId, table.createdAt),
}));