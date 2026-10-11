import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  boolean,
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
import { athleteInvitesTable } from "./athleteInvites";
import { scheduleSharesTable } from "./scheduleShares";

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
  mediaRole: text("media_role").notNull().default("legacy"),
  size: integer("size").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectMediaUploadClaimsTable = pgTable("project_media_upload_claims", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerClerkUserId: text("owner_clerk_user_id").notNull(),
  projectId: uuid("project_id").references(() => cloudProjectsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  contentType: text("content_type").notNull(),
  mediaRole: text("media_role").notNull(),
  size: integer("size").notNull(),
  objectPath: text("object_path").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  expiresAtIndex: index("project_media_upload_claims_expires_at_index").on(table.expiresAt),
}));

export const supporterPhotosTable = pgTable("supporter_photos", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerClerkUserId: text("owner_clerk_user_id").notNull(),
  objectPath: text("object_path").notNull().unique(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  cropX: integer("crop_x").notNull().default(50),
  cropY: integer("crop_y").notNull().default(50),
  cropZoom: integer("crop_zoom").notNull().default(100),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  ownerUnique: uniqueIndex("supporter_photos_owner_unique").on(table.ownerClerkUserId),
}));

export const supporterPhotoUploadClaimsTable = pgTable("supporter_photo_upload_claims", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerClerkUserId: text("owner_clerk_user_id").notNull(),
  objectPath: text("object_path").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  objectPathUnique: uniqueIndex("supporter_photo_upload_claims_object_path_unique").on(table.objectPath),
  expiresAtIndex: index("supporter_photo_upload_claims_expires_at_index").on(table.expiresAt),
}));

export { scheduleSharesTable };

export const athleteInviteEventLinksTable = pgTable("athlete_invite_event_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  inviteId: uuid("invite_id").notNull().references(() => athleteInvitesTable.id, { onDelete: "cascade" }),
  shareId: uuid("share_id").notNull().references(() => scheduleSharesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  inviteShareUnique: uniqueIndex("athlete_invite_event_links_invite_share_unique").on(table.inviteId, table.shareId),
  inviteIndex: index("athlete_invite_event_links_invite_index").on(table.inviteId),
  shareIndex: index("athlete_invite_event_links_share_index").on(table.shareId),
}));

export const athleteInviteEventDeliveryClaimsTable = pgTable("athlete_invite_event_delivery_claims", {
  id: uuid("id").defaultRandom().primaryKey(),
  inviteId: uuid("invite_id").notNull(),
  shareId: uuid("share_id").notNull(),
  eventId: text("event_id").notNull(),
  deviceKeyHash: text("device_key_hash").notNull(),
  result: text("result").notNull().default("claimed"),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => ({
  deliveryUnique: uniqueIndex("athlete_invite_event_delivery_claims_event_device_unique")
    .on(table.inviteId, table.eventId, table.deviceKeyHash),
  shareIndex: index("athlete_invite_event_delivery_claims_share_index").on(table.shareId),
}));

export const hypeCardSharesTable = pgTable("hype_card_shares", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerClerkUserId: text("owner_clerk_user_id").notNull(),
  publicToken: text("public_token").notNull(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  mediaName: text("media_name"),
  manifest: jsonb("manifest").notNull(),
  shareKey: text("share_key"),
  shareMode: text("share_mode").notNull().default("card"),
  mediaType: text("media_type").notNull().default("video"),
  videoObjectPath: text("video_object_path"),
  videoContentType: text("video_content_type"),
  videoSize: integer("video_size"),
  posterObjectPath: text("poster_object_path"),
  posterContentType: text("poster_content_type"),
  posterSize: integer("poster_size"),
  trackerProjectId: uuid("tracker_project_id").references(() => cloudProjectsTable.id, {
    onDelete: "set null",
  }),
  athleteName: text("athlete_name"),
  sport: text("sport"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  publicTokenUnique: uniqueIndex("hype_card_shares_public_token_unique").on(table.publicToken),
  activeShareKeyUnique: uniqueIndex("hype_card_shares_active_share_key_unique")
    .on(table.ownerClerkUserId, table.shareKey)
    .where(sql`${table.revokedAt} is null`),
}));

export const hypeCardShareRepliesTable = pgTable("hype_card_share_replies", {
  id: uuid("id").defaultRandom().primaryKey(),
  shareId: uuid("share_id").notNull().references(() => hypeCardSharesTable.id, {
    onDelete: "cascade",
  }),
  reaction: text("reaction").notNull(),
  message: text("message"),
  rateLimitKey: text("rate_limit_key").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  shareCreatedIndex: index("hype_card_share_replies_share_created_index").on(table.shareId, table.createdAt),
  rateLimitIndex: index("hype_card_share_replies_rate_limit_index").on(table.rateLimitKey, table.createdAt),
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

export const accountAccessTable = pgTable("account_access", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerClerkUserId: text("owner_clerk_user_id").notNull(),
  role: text("role").notNull(),
  accessMode: text("access_mode").notNull(),
  lifecycleStatus: text("lifecycle_status").notNull().default("active"),
  pauseEndsAt: timestamp("pause_ends_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
  deletionEligibleAt: timestamp("deletion_eligible_at", { withTimezone: true }),
  purgeStartedAt: timestamp("purge_started_at", { withTimezone: true }),
  purgeError: text("purge_error"),
  adminSuspendedAt: timestamp("admin_suspended_at", { withTimezone: true }),
  adminSuspendedByClerkUserId: text("admin_suspended_by_clerk_user_id"),
  adminDeletionActionId: uuid("admin_deletion_action_id"),
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
  planTier: text("plan_tier").notNull().default("plus"),
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

export const webPushSubscriptionsTable = pgTable("web_push_subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerClerkUserId: text("owner_clerk_user_id").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  timezone: text("timezone").notNull().default("UTC"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  endpointUnique: uniqueIndex("web_push_subscriptions_endpoint_unique").on(table.endpoint),
  ownerIndex: index("web_push_subscriptions_owner_index").on(table.ownerClerkUserId),
}));

export const plannerNotificationPreferencesTable = pgTable("planner_notification_preferences", {
  ownerClerkUserId: text("owner_clerk_user_id").primaryKey(),
  oneHourBefore: boolean("one_hour_before").notNull().default(false),
  dayOf: boolean("day_of").notNull().default(false),
  timezone: text("timezone"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const plannerNotificationDeliveriesTable = pgTable("planner_notification_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => cloudProjectsTable.id, {
    onDelete: "cascade",
  }),
  eventId: text("event_id").notNull(),
  notificationType: text("notification_type").notNull(),
  eventDate: text("event_date").notNull(),
  displayedAt: timestamp("displayed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  deliveryUnique: uniqueIndex("planner_notification_deliveries_key_unique").on(
    table.projectId,
    table.eventId,
    table.notificationType,
    table.eventDate,
  ),
  projectIndex: index("planner_notification_deliveries_project_index").on(table.projectId),
}));

export const plannerCardNotificationDeliveriesTable = pgTable("planner_card_notification_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  shareId: uuid("share_id").notNull().references(() => scheduleSharesTable.id, {
    onDelete: "cascade",
  }),
  eventId: text("event_id").notNull(),
  notificationType: text("notification_type").notNull(),
  eventDate: text("event_date").notNull(),
  displayedAt: timestamp("displayed_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  deliveryUnique: uniqueIndex("planner_card_notification_deliveries_key_unique").on(
    table.shareId,
    table.eventId,
    table.notificationType,
    table.eventDate,
  ),
  shareIndex: index("planner_card_notification_deliveries_share_index").on(table.shareId),
}));

export const plannerOwnerEventAlertClaimsTable = pgTable("planner_owner_event_alert_claims", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerClerkUserId: text("owner_clerk_user_id").notNull(),
  eventId: text("event_id").notNull(),
  eventDate: text("event_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  eventUnique: uniqueIndex("planner_owner_event_alert_claims_event_unique").on(
    table.ownerClerkUserId,
    table.eventId,
    table.eventDate,
  ),
}));

export const internalJobRequestsTable = pgTable("internal_job_requests", {
  nonce: text("nonce").primaryKey(),
  jobName: text("job_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  createdAtIndex: index("internal_job_requests_created_at_index").on(table.createdAt),
}));

export * from "./checklistShares";
export * from "./meetingWorkspaces";
export * from "./statTrackerShares";
export * from "./athleteInvites";
export * from "./athleteInviteLiveTaps";
export * from "./athleteInviteFans";
export * from "./supporterActiveGames";
export * from "./gameOnReminders";
export * from "./admin";
export * from "./adminIdentityBlocks";
export * from "./supportTickets";

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
export type ProjectMediaUploadClaim = typeof projectMediaUploadClaimsTable.$inferSelect;
export type SupporterPhoto = typeof supporterPhotosTable.$inferSelect;
export type ScheduleShare = typeof scheduleSharesTable.$inferSelect;
export type HypeCardShare = typeof hypeCardSharesTable.$inferSelect;
export type HypeCardShareReply = typeof hypeCardShareRepliesTable.$inferSelect;
export type HypeCardShareUploadClaim = typeof hypeCardShareUploadClaimsTable.$inferSelect;
export type AccountAccess = typeof accountAccessTable.$inferSelect;
export type AccountEntitlementEvent = typeof accountEntitlementEventsTable.$inferSelect;
export type GuestUsageEvent = typeof guestUsageEventsTable.$inferSelect;
export type WebPushSubscription = typeof webPushSubscriptionsTable.$inferSelect;
export type PlannerNotificationDelivery = typeof plannerNotificationDeliveriesTable.$inferSelect;