import { createInsertSchema } from "drizzle-zod";
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const athleteInvitePhotoUploadClaimsTable = pgTable("athlete_invite_photo_upload_claims", {
  id: uuid("id").defaultRandom().primaryKey(),
  inviteId: uuid("invite_id").notNull(),
  ownerClerkUserId: text("owner_clerk_user_id").notNull(),
  objectPath: text("object_path").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  objectPathUnique: uniqueIndex("athlete_invite_photo_upload_claims_path_unique").on(table.objectPath),
  expiresAtIndex: index("athlete_invite_photo_upload_claims_expiry_index").on(table.expiresAt),
}));

export const athleteInviteFansTable = pgTable("athlete_invite_fans", {
  id: uuid("id").defaultRandom().primaryKey(),
  inviteId: uuid("invite_id").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  followTokenHash: text("follow_token_hash").notNull(),
  liveAlerts: boolean("live_alerts").notNull(),
  eventAlerts: boolean("event_alerts").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  endpointUnique: uniqueIndex("athlete_invite_fans_invite_endpoint_unique").on(table.inviteId, table.endpoint),
  tokenUnique: uniqueIndex("athlete_invite_fans_token_unique").on(table.followTokenHash),
  inviteIndex: index("athlete_invite_fans_invite_index").on(table.inviteId),
}));

export const athleteInviteFanDeliveriesTable = pgTable("athlete_invite_fan_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  inviteId: uuid("invite_id").notNull(),
  eventKey: text("event_key").notNull(),
  notificationType: text("notification_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  deliveryUnique: uniqueIndex("athlete_invite_fan_deliveries_key_unique")
    .on(table.inviteId, table.eventKey, table.notificationType),
}));

export const athleteInviteFanRateLimitsTable = pgTable("athlete_invite_fan_rate_limits", {
  id: uuid("id").defaultRandom().primaryKey(),
  rateKey: text("rate_key").notNull(),
  ownerClerkUserId: text("owner_clerk_user_id"),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
}, (table) => ({
  keyUnique: uniqueIndex("athlete_invite_fan_rate_limits_key_unique").on(table.rateKey),
  windowIndex: index("athlete_invite_fan_rate_limits_window_index").on(table.windowStartedAt),
}));

export const insertAthleteInviteFanSchema = createInsertSchema(athleteInviteFansTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAthleteInviteFan = z.infer<typeof insertAthleteInviteFanSchema>;
export type AthleteInviteFan = typeof athleteInviteFansTable.$inferSelect;