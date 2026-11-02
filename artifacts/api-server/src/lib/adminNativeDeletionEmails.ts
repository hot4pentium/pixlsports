import { pool } from "@workspace/db";
import type { AdminNativeDeletionEmail } from "@workspace/api-zod";
import { NATIVE_DELETION_EMAIL_RETENTION_DAYS, NATIVE_DELETION_EMAIL_RETRY_WINDOW_MS } from "./nativeDeletionEmailPolicy";

type MailRecord = {
  id: string;
  scope: AdminNativeDeletionEmail["scope"];
  requested_at: Date;
  completed_at: Date | null;
  has_contact: boolean;
  completion_email_first_attempt_at: Date | null;
  completion_email_last_attempt_at: Date | null;
  completion_email_sent_at: Date | null;
};

export function nativeDeletionMailStage(row: MailRecord, now: number): AdminNativeDeletionEmail["stage"] {
  if (!row.completed_at) return "awaiting_cleanup";
  if (row.completion_email_sent_at) return "provider_accepted";
  // Age is authoritative even before the retention sweep erases the address.
  if (now - row.completed_at.getTime() > NATIVE_DELETION_EMAIL_RETENTION_DAYS * 86400000) {
    return "contact_retention_expired";
  }
  if (!row.has_contact) return "no_verified_contact";
  if (row.completion_email_first_attempt_at) {
    return now - row.completion_email_first_attempt_at.getTime() >= NATIVE_DELETION_EMAIL_RETRY_WINDOW_MS
      ? "review_required" : "delivery_uncertain";
  }
  return "waiting_to_send";
}

export async function listAdminNativeDeletionEmails({ limit, offset }: { limit: number; offset: number }) {
  // No profile/provider joins: deletion tombstones remain readable after both
  // identities and owned data have gone. Never select the retained recipient.
  const result = await pool.query<MailRecord>(`SELECT id,scope,requested_at,completed_at,
    completion_email IS NOT NULL AS has_contact,
    completion_email_first_attempt_at,completion_email_last_attempt_at,completion_email_sent_at
    FROM native_account_deletions ORDER BY requested_at DESC,id DESC LIMIT $1 OFFSET $2`, [limit, offset]);
  const count = await pool.query<{ total: string }>("SELECT count(*) AS total FROM native_account_deletions");
  const now = Date.now();
  return {
    items: result.rows.map((row): AdminNativeDeletionEmail => ({
      reference: row.id,
      scope: row.scope,
      stage: nativeDeletionMailStage(row, now),
      requestedAt: row.requested_at,
      completedAt: row.completed_at,
      firstAttemptAt: row.completion_email_first_attempt_at,
      lastAttemptAt: row.completion_email_last_attempt_at,
      providerAcceptedAt: row.completion_email_sent_at,
    })),
    total: Number(count.rows[0].total),
    limit,
    offset,
  };
}
