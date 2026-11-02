import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// Permanent, minimal tombstones prevent a still-valid JWT or setup retry from
// recreating access. A verified email is held only until the completion notice
// is accepted by the email provider, then erased; no profile/media is retained.
export const nativeAccountDeletionsTable = pgTable("native_account_deletions", {
  id: uuid("id").defaultRandom().primaryKey(),
  nativeIssuer: text("native_issuer").notNull(),
  nativeSubject: text("native_subject").notNull(),
  ownerId: text("owner_id"),
  scope: text("scope").notNull(),
  target: text("target").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completionEmail: text("completion_email"),
  completionEmailResolvedAt: timestamp("completion_email_resolved_at", { withTimezone: true }),
  completionEmailFirstAttemptAt: timestamp("completion_email_first_attempt_at", { withTimezone: true }),
  completionEmailLastAttemptAt: timestamp("completion_email_last_attempt_at", { withTimezone: true }),
  completionEmailSentAt: timestamp("completion_email_sent_at", { withTimezone: true }),
}, (table) => ({
  identity: uniqueIndex("native_account_deletions_identity_unique").on(table.nativeIssuer, table.nativeSubject),
}));
