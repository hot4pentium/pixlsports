import { jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Native-only profiles have their own owner namespace. Existing explicit
// account links continue to reference their original Clerk-backed owners.
export const nativeAccountsTable = pgTable("native_accounts", {
  ownerId: text("owner_id").primaryKey(),
  nativeIssuer: text("native_issuer").notNull(),
  nativeSubject: text("native_subject").notNull(),
  profileMetadata: jsonb("profile_metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  identity: uniqueIndex("native_accounts_identity_unique").on(table.nativeIssuer, table.nativeSubject),
}));
