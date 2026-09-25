import { createInsertSchema } from "drizzle-zod";
import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
  paused: boolean("paused").notNull().default(false),
  liveTrackerShareToken: text("live_tracker_share_token"),
  photoObjectPath: text("photo_object_path"),
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