import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const adminUsersTable = pgTable("admin_users", {
  clerkUserId: text("clerk_user_id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adminActionAuditTable = pgTable("admin_action_audit", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorClerkUserId: text("actor_clerk_user_id").notNull(),
  targetClerkUserId: text("target_clerk_user_id").notNull(),
  action: text("action").notNull(),
  status: text("status").notNull(),
  changedFields: jsonb("changed_fields").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  reason: text("reason"),
  failureCode: text("failure_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => ({
  actorCreatedAtIndex: index("admin_action_audit_actor_created_at_index").on(table.actorClerkUserId, table.createdAt),
  targetCreatedAtIndex: index("admin_action_audit_target_created_at_index").on(table.targetClerkUserId, table.createdAt),
}));