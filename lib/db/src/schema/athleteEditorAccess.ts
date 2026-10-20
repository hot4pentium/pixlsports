import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const athleteEditorAccessTable = pgTable("athlete_editor_access", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerClerkUserId: text("owner_clerk_user_id").notNull(),
  athleteInviteId: uuid("athlete_invite_id").notNull(),
  projectId: uuid("project_id"),
  athleteEmail: text("athlete_email").notNull(),
  clerkInvitationId: text("clerk_invitation_id"),
  athleteClerkUserId: text("athlete_clerk_user_id"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  athleteUserUnique: uniqueIndex("athlete_editor_access_user_unique").on(table.athleteClerkUserId),
  inviteActiveUnique: uniqueIndex("athlete_editor_access_invite_active_unique")
    .on(table.athleteInviteId)
    .where(sql`${table.status} in ('pending', 'active')`),
  projectActiveUnique: uniqueIndex("athlete_editor_access_project_active_unique")
    .on(table.projectId)
    .where(sql`${table.status} in ('pending', 'active')`),
  inviteStatusIndex: index("athlete_editor_access_invite_status_index").on(table.athleteInviteId, table.status),
  projectStatusIndex: index("athlete_editor_access_project_status_index").on(table.projectId, table.status),
}));

export type AthleteEditorAccess = typeof athleteEditorAccessTable.$inferSelect;
