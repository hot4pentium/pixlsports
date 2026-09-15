import { createInsertSchema } from "drizzle-zod";
import {
  integer,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const cloudProjectsTable = pgTable("cloud_projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerClerkUserId: text("owner_clerk_user_id").notNull(),
  name: text("name").notNull(),
  project: jsonb("project").notNull(),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const projectMediaTable = pgTable("project_media", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerClerkUserId: text("owner_clerk_user_id").notNull(),
  projectId: uuid("project_id").references(() => cloudProjectsTable.id, {
    onDelete: "cascade",
  }),
  objectPath: text("object_path").notNull().unique(),
  name: text("name").notNull(),
  contentType: text("content_type").notNull(),
  mediaType: text("media_type").notNull(),
  size: integer("size").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const scheduleSharesTable = pgTable("schedule_shares", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerClerkUserId: text("owner_clerk_user_id").notNull(),
  title: text("title").notNull(),
  teamSeason: text("team_season").notNull(),
  events: jsonb("events").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const hypeCardSharesTable = pgTable("hype_card_shares", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerClerkUserId: text("owner_clerk_user_id").notNull(),
  publicToken: text("public_token").notNull(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  manifest: jsonb("manifest").notNull(),
  videoObjectPath: text("video_object_path").notNull(),
  videoContentType: text("video_content_type").notNull(),
  videoSize: integer("video_size").notNull(),
  posterObjectPath: text("poster_object_path").notNull(),
  posterContentType: text("poster_content_type").notNull(),
  posterSize: integer("poster_size").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  publicTokenUnique: uniqueIndex("hype_card_shares_public_token_unique").on(table.publicToken),
}));

export const hypeCardShareUploadClaimsTable = pgTable("hype_card_share_upload_claims", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerClerkUserId: text("owner_clerk_user_id").notNull(),
  mediaKind: text("media_kind").notNull(),
  objectPath: text("object_path").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  objectPathUnique: uniqueIndex("hype_card_share_upload_claims_object_path_unique").on(table.objectPath),
  expiresAtIndex: index("hype_card_share_upload_claims_expires_at_index").on(table.expiresAt),
}));

export const coachCalendarCodesTable = pgTable("coach_calendar_codes", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerClerkUserId: text("owner_clerk_user_id").notNull(),
  code: text("code").notNull(),
  subscriptionToken: text("subscription_token"),
  subscriptionRevokedAt: timestamp("subscription_revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerUnique: uniqueIndex("coach_calendar_codes_owner_unique").on(table.ownerClerkUserId),
  codeUnique: uniqueIndex("coach_calendar_codes_code_unique").on(table.code),
  subscriptionTokenUnique: uniqueIndex("coach_calendar_codes_subscription_token_unique").on(table.subscriptionToken),
}));

export const accountAccessTable = pgTable("account_access", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerClerkUserId: text("owner_clerk_user_id").notNull(),
  role: text("role").notNull(),
  accessMode: text("access_mode").notNull(),
  lifecycleStatus: text("lifecycle_status").notNull().default("active"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
  deletionEligibleAt: timestamp("deletion_eligible_at", { withTimezone: true }),
  purgeStartedAt: timestamp("purge_started_at", { withTimezone: true }),
  purgeError: text("purge_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  ownerUnique: uniqueIndex("account_access_owner_unique").on(table.ownerClerkUserId),
}));

export const accountEntitlementEventsTable = pgTable("account_entitlement_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  providerEventId: text("provider_event_id").notNull(),
  ownerClerkUserId: text("owner_clerk_user_id").notNull(),
  entitlementExpiresAt: timestamp("entitlement_expires_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  providerEventUnique: uniqueIndex("account_entitlement_events_provider_event_unique").on(table.providerEventId),
}));

export const guestUsageEventsTable = pgTable("guest_usage_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerClerkUserId: text("owner_clerk_user_id").notNull(),
  category: text("category").notNull(),
  usageKey: text("usage_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  usageKeyUnique: uniqueIndex("guest_usage_events_key_unique").on(
    table.ownerClerkUserId,
    table.category,
    table.usageKey,
  ),
}));

export const insertCloudProjectSchema = createInsertSchema(cloudProjectsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCloudProject = z.infer<typeof insertCloudProjectSchema>;
export type CloudProject = typeof cloudProjectsTable.$inferSelect;

export const insertProjectMediaSchema = createInsertSchema(projectMediaTable).omit({
  id: true,
  createdAt: true,
});
export type InsertProjectMedia = z.infer<typeof insertProjectMediaSchema>;
export type ProjectMedia = typeof projectMediaTable.$inferSelect;
export type ScheduleShare = typeof scheduleSharesTable.$inferSelect;
export type HypeCardShare = typeof hypeCardSharesTable.$inferSelect;
export type HypeCardShareUploadClaim = typeof hypeCardShareUploadClaimsTable.$inferSelect;
export type CoachCalendarCode = typeof coachCalendarCodesTable.$inferSelect;
export type AccountAccess = typeof accountAccessTable.$inferSelect;
export type AccountEntitlementEvent = typeof accountEntitlementEventsTable.$inferSelect;
export type GuestUsageEvent = typeof guestUsageEventsTable.$inferSelect;