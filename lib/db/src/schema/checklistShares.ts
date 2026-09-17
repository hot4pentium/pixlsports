import { createInsertSchema } from "drizzle-zod";
import { jsonb, pgTable, text, timestamp, integer, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const checklistSharesTable = pgTable("checklist_shares", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerClerkUserId: text("owner_clerk_user_id").notNull(),
  title: text("title").notNull(),
  mode: text("mode").notNull().default("gameday"),
  items: jsonb("items").notNull(),
  selectedGame: jsonb("selected_game"),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertChecklistShareSchema = createInsertSchema(checklistSharesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertChecklistShare = z.infer<typeof insertChecklistShareSchema>;
export type ChecklistShare = typeof checklistSharesTable.$inferSelect;