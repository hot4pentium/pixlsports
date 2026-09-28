import { createInsertSchema } from "drizzle-zod";
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { scheduleSharesTable } from "./scheduleShares";

export const gameOnScheduledRemindersTable = pgTable("game_on_scheduled_reminders", {
  id: uuid("id").defaultRandom().primaryKey(),
  shareId: uuid("share_id").notNull().references(() => scheduleSharesTable.id, { onDelete: "cascade" }),
  ownerClerkUserId: text("owner_clerk_user_id").notNull(),
  eventId: text("event_id").notNull(),
  eventDate: text("event_date").notNull(),
  eventTime: text("event_time").notNull(),
  eventType: text("event_type").notNull(),
  timezone: text("timezone").notNull(),
  reminderType: text("reminder_type").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("pending"),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
  claimToken: uuid("claim_token"),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  eventClaimId: uuid("event_claim_id"),
  attemptCount: integer("attempt_count").notNull().default(0),
  lastFailure: text("last_failure"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  eventUnique: uniqueIndex("game_on_scheduled_reminders_event_unique")
    .on(table.shareId, table.eventId, table.eventDate, table.reminderType),
  dueIndex: index("game_on_scheduled_reminders_due_index")
    .on(table.status, table.nextAttemptAt, table.dueAt),
  ownerIndex: index("game_on_scheduled_reminders_owner_index").on(table.ownerClerkUserId),
}));

export const gameOnReminderAttemptsTable = pgTable("game_on_reminder_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  reminderId: uuid("reminder_id").notNull()
    .references(() => gameOnScheduledRemindersTable.id, { onDelete: "cascade" }),
  subscriptionId: uuid("subscription_id").notNull(),
  status: text("status").notNull().default("sending"),
  failureCategory: text("failure_category"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => ({
  reminderIndex: index("game_on_reminder_attempts_reminder_index")
    .on(table.reminderId, table.subscriptionId, table.startedAt),
}));

export const gameOnReminderSyncTable = pgTable("game_on_reminder_sync", {
  key: text("key").primaryKey(),
  cursor: uuid("cursor"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
});

export const insertGameOnScheduledReminderSchema = createInsertSchema(gameOnScheduledRemindersTable)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertGameOnScheduledReminder = z.infer<typeof insertGameOnScheduledReminderSchema>;
export type GameOnScheduledReminder = typeof gameOnScheduledRemindersTable.$inferSelect;