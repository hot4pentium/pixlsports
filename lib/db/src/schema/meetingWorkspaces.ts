import { createInsertSchema } from "drizzle-zod";
import { jsonb, pgTable, text, timestamp, integer, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const meetingWorkspacesTable = pgTable("meeting_workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerClerkUserId: text("owner_clerk_user_id").notNull(),
  ownerMeetingId: text("owner_meeting_id").notNull(),
  publicToken: text("public_token").notNull(),
  workspace: jsonb("workspace").notNull(),
  revision: integer("revision").notNull().default(1),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  publicTokenUnique: uniqueIndex("meeting_workspaces_public_token_unique").on(table.publicToken),
  ownerMeetingUnique: uniqueIndex("meeting_workspaces_owner_meeting_unique").on(
    table.ownerClerkUserId,
    table.ownerMeetingId,
  ),
}));

export const insertMeetingWorkspaceSchema = createInsertSchema(meetingWorkspacesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertMeetingWorkspace = z.infer<typeof insertMeetingWorkspaceSchema>;
export type MeetingWorkspace = typeof meetingWorkspacesTable.$inferSelect;