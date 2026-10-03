import { createInsertSchema } from "drizzle-zod";
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const athleteInvitesTable = pgTable("athlete_invites", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerClerkUserId: text("owner_clerk_user_id").notNull(),
  publicToken: text("public_token").notNull(),
  athleteName: text("athlete_name").notNull(),
  teamName: text("team_name").notNull(),
  seasonName: text("season_name").notNull(),
  seasonEndsAt: timestamp("season_ends_at", { withTimezone: true }).notNull(),
  sport: text("sport").notNull(),
  timezone: text("timezone"),
  trackerProjectId: uuid("tracker_project_id"),
  scheduleProjectId: uuid("schedule_project_id"),
  showHypeCard: boolean("show_hype_card").notNull().default(true),
  showStats: boolean("show_stats").notNull().default(true),
  showSchedule: boolean("show_schedule").notNull().default(true),
  showEvents: boolean("show_events").notNull().default(false),
  hypesEnabled: boolean("hypes_enabled").notNull().default(true),
  paused: boolean("paused").notNull().default(false),
  liveTrackerShareToken: text("live_tracker_share_token"),
  photoObjectPath: text("photo_object_path"),
  cutoutObjectPath: text("cutout_object_path"),
  cardAppearance: jsonb("card_appearance").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  ownerUnique: uniqueIndex("athlete_invites_owner_unique").on(table.ownerClerkUserId),
  publicTokenUnique: uniqueIndex("athlete_invites_public_token_unique").on(table.publicToken),
}));

export const insertAthleteInviteSchema = createInsertSchema(athleteInvitesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAthleteInvite = z.infer<typeof insertAthleteInviteSchema>;
export type AthleteInvite = typeof athleteInvitesTable.$inferSelect;

export const athleteInviteHypesTable = pgTable("athlete_invite_hypes", {
  id: uuid("id").defaultRandom().primaryKey(),
  inviteId: uuid("invite_id").notNull().references(() => athleteInvitesTable.id, { onDelete: "cascade" }),
  reaction: text("reaction").notNull(),
  senderName: text("sender_name"),
  message: text("message"),
  publiclyVisible: boolean("publicly_visible").notNull().default(false),
  rateLimitKey: text("rate_limit_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  inviteIndex: index("athlete_invite_hypes_invite_created_index").on(table.inviteId, table.createdAt),
  rateIndex: index("athlete_invite_hypes_rate_created_index").on(table.rateLimitKey, table.createdAt),
}));