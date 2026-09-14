import { createInsertSchema } from "drizzle-zod";
import {
  integer,
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

export const coachCalendarCodesTable = pgTable("coach_calendar_codes", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerClerkUserId: text("owner_clerk_user_id").notNull(),
  code: text("code").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerUnique: uniqueIndex("coach_calendar_codes_owner_unique").on(table.ownerClerkUserId),
  codeUnique: uniqueIndex("coach_calendar_codes_code_unique").on(table.code),
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
export type CoachCalendarCode = typeof coachCalendarCodesTable.$inferSelect;