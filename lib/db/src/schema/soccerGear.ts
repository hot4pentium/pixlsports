import { boolean, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { athleteInvitesTable } from "./athleteInvites";

export const soccerGearLooksTable = pgTable("soccer_gear_looks", {
  inviteId: uuid("invite_id").primaryKey().references(() => athleteInvitesTable.id, { onDelete: "cascade" }),
  loadout: jsonb("loadout").notNull().$type<Record<string, unknown>>(),
  showOnHypeCard: boolean("show_on_hype_card").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// No FK to a card: deleting/replacing a card must not remove earned progress.
export const soccerGearActivityTable = pgTable("soccer_gear_activity", {
  ownerClerkUserId: text("owner_clerk_user_id").notNull(),
  kind: text("kind").notNull(),
  eventKey: text("event_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.ownerClerkUserId, table.kind, table.eventKey] }),
]);

export const insertSoccerGearLookSchema = createInsertSchema(soccerGearLooksTable);
export const insertSoccerGearActivitySchema = createInsertSchema(soccerGearActivityTable);
export type InsertSoccerGearLook = z.infer<typeof insertSoccerGearLookSchema>;
export type InsertSoccerGearActivity = z.infer<typeof insertSoccerGearActivitySchema>;
