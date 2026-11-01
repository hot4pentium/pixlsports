import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const nativePushSubscriptionsTable = pgTable("native_push_subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  deviceId: text("device_id").notNull(),
  deviceToken: text("device_token").notNull(),
  environment: text("environment").notNull(),
  ownerClerkUserId: text("owner_clerk_user_id").notNull(),
  nativeIssuer: text("native_issuer").notNull(),
  nativeSubject: text("native_subject").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  deviceEnvironmentUnique: uniqueIndex("native_push_subscriptions_device_environment_unique")
    .on(table.deviceId, table.environment),
  tokenEnvironmentUnique: uniqueIndex("native_push_subscriptions_token_environment_unique")
    .on(table.deviceToken, table.environment),
  ownerIndex: index("native_push_subscriptions_owner_index").on(table.ownerClerkUserId),
  identityIndex: index("native_push_subscriptions_identity_index")
    .on(table.nativeIssuer, table.nativeSubject),
}));

export type NativePushSubscription = typeof nativePushSubscriptionsTable.$inferSelect;
