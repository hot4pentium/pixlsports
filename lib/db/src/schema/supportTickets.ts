import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export type SupportDiagnostics = {
  connection: "online" | "offline" | "not-run";
  browserStorage: "available" | "unavailable" | "not-run";
  service: "available" | "unavailable" | "not-run";
};

export const supportTicketsTable = pgTable("support_tickets", {
  id: uuid("id").defaultRandom().primaryKey(),
  reference: text("reference").notNull(),
  ownerClerkUserId: text("owner_clerk_user_id"),
  accessTokenHash: text("access_token_hash").notNull(),
  recoveryCodeHash: text("recovery_code_hash"),
  recoveryCodeExpiresAt: timestamp("recovery_code_expires_at", { withTimezone: true }),
  recoveryRequestedAt: timestamp("recovery_requested_at", { withTimezone: true }),
  recoveryAttempts: integer("recovery_attempts").notNull().default(0),
  replyEmail: text("reply_email").notNull(),
  issueId: text("issue_id").notNull(),
  description: text("description").notNull(),
  deviceType: text("device_type").notNull(),
  connectionType: text("connection_type").notNull(),
  diagnostics: jsonb("diagnostics").$type<SupportDiagnostics>(),
  status: text("status").notNull().default("unread"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  referenceUnique: uniqueIndex("support_tickets_reference_unique").on(table.reference),
  ownerUpdatedIndex: index("support_tickets_owner_updated_index").on(table.ownerClerkUserId, table.updatedAt),
  statusUpdatedIndex: index("support_tickets_status_updated_index").on(table.status, table.updatedAt),
}));

export const supportTicketEmailReplyTokensTable = pgTable("support_ticket_email_reply_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  ticketId: uuid("ticket_id").notNull().references(() => supportTicketsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ticketCreatedIndex: index("support_ticket_email_reply_tokens_ticket_created_index").on(table.ticketId, table.createdAt),
}));

export const supportTicketMessagesTable = pgTable("support_ticket_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  ticketId: uuid("ticket_id").notNull().references(() => supportTicketsTable.id, { onDelete: "cascade" }),
  senderRole: text("sender_role").notNull(),
  senderClerkUserId: text("sender_clerk_user_id"),
  body: text("body").notNull(),
  deliveryStatus: text("delivery_status").notNull().default("not_applicable"),
  emailProviderMessageId: text("email_provider_message_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ticketCreatedIndex: index("support_ticket_messages_ticket_created_index").on(table.ticketId, table.createdAt),
  emailProviderMessageUnique: uniqueIndex("support_ticket_messages_email_provider_message_id_unique").on(table.emailProviderMessageId),
}));

export type SupportTicket = typeof supportTicketsTable.$inferSelect;
export type SupportTicketMessage = typeof supportTicketMessagesTable.$inferSelect;
