import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const scheduleSharesTable = pgTable("schedule_shares", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerClerkUserId: text("owner_clerk_user_id").notNull(),
  title: text("title").notNull(),
  teamSeason: text("team_season").notNull(),
  events: jsonb("events").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  ownerUpdatedIndex: index("schedule_shares_owner_updated_index")
    .on(table.ownerClerkUserId, table.updatedAt),
}));