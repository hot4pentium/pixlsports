import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const nativeAccountLinksTable = pgTable("native_account_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  nativeIssuer: text("native_issuer").notNull(),
  nativeSubject: text("native_subject").notNull(),
  ownerClerkUserId: text("owner_clerk_user_id").notNull(),
  accountLabel: text("account_label").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  nativeIdentity: uniqueIndex("native_account_links_identity_unique").on(table.nativeIssuer, table.nativeSubject),
  webIdentity: uniqueIndex("native_account_links_owner_unique").on(table.ownerClerkUserId),
}));
export const insertNativeAccountLinkSchema = createInsertSchema(nativeAccountLinksTable).omit({ id: true, createdAt: true });
export type NativeAccountLink = typeof nativeAccountLinksTable.$inferSelect;
