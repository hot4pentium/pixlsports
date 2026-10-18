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

// Sport showcase gear belongs to the owner's profile, not to a HYPE Card.
export const athleteSportGearLooksTable = pgTable("athlete_sport_gear_looks", {
  ownerClerkUserId: text("owner_clerk_user_id").notNull(),
  sport: text("sport").notNull(),
  loadout: jsonb("loadout").notNull().$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  primaryKey({ columns: [table.ownerClerkUserId, table.sport] }),
]);

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
export const insertAthleteSportGearLookSchema = createInsertSchema(athleteSportGearLooksTable).omit({ createdAt: true, updatedAt: true });
export const insertSoccerGearActivitySchema = createInsertSchema(soccerGearActivityTable);
export type InsertSoccerGearLook = z.infer<typeof insertSoccerGearLookSchema>;
export type InsertAthleteSportGearLook = z.infer<typeof insertAthleteSportGearLookSchema>;
export type InsertSoccerGearActivity = z.infer<typeof insertSoccerGearActivitySchema>;
