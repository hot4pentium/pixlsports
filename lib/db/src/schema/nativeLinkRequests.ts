import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const nativeLinkRequestsTable = pgTable("native_link_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  nativeIssuer: text("native_issuer").notNull(),
  nativeSubject: text("native_subject").notNull(),
  codeHash: text("code_hash").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  status: text("status").notNull().default("pending"),
  ownerClerkUserId: text("owner_clerk_user_id"),
  accountLabel: text("account_label"),
  completedLinkId: uuid("completed_link_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => ({
  code: uniqueIndex("native_link_requests_code_unique").on(table.codeHash),
  identity: index("native_link_requests_identity_index").on(table.nativeIssuer, table.nativeSubject),
}));
export const insertNativeLinkRequestSchema = createInsertSchema(nativeLinkRequestsTable).omit({ id: true, createdAt: true });
export type NativeLinkRequest = typeof nativeLinkRequestsTable.$inferSelect;
