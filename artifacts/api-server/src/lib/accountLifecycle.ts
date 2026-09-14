import { and, eq, gt } from "drizzle-orm";
import { accountAccessTable, db } from "@workspace/db";

export const ACCOUNT_RETENTION_DAYS = 90;
const ACCOUNT_RETENTION_MS = ACCOUNT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export type AccountLifecycleStatus = "active" | "cancelled" | "deletion_pending";

function asStatus(value: string | null | undefined): AccountLifecycleStatus {
  if (value === "cancelled" || value === "deletion_pending") return value;
  return "active";
}

function addRetentionWindow(date: Date) {
  return new Date(date.getTime() + ACCOUNT_RETENTION_MS);
}

export async function getAccountLifecycleSnapshot(
  ownerClerkUserId: string,
  options: { touchCancelledActivity?: boolean } = {},
) {
  let [access] = await db
    .select()
    .from(accountAccessTable)
    .where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId))
    .limit(1);

  const now = new Date();
  const status = asStatus(access?.lifecycleStatus);
  const expired = status === "deletion_pending"
    || (status === "cancelled"
      && Boolean(access?.deletionEligibleAt)
      && access!.deletionEligibleAt!.getTime() <= now.getTime());

  if (access && status === "cancelled" && !expired && options.touchCancelledActivity) {
    const deletionEligibleAt = addRetentionWindow(now);
    const [touched] = await db
      .update(accountAccessTable)
      .set({
        lastActivityAt: now,
        deletionEligibleAt,
        updatedAt: now,
      })
      .where(and(
        eq(accountAccessTable.id, access.id),
        eq(accountAccessTable.lifecycleStatus, "cancelled"),
        gt(accountAccessTable.deletionEligibleAt, now),
      ))
      .returning();
    if (touched) {
      access = touched;
    } else {
      [access] = await db
        .select()
        .from(accountAccessTable)
        .where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId))
        .limit(1);
    }
  }

  return {
    status: asStatus(access?.lifecycleStatus),
    cancelledAt: access?.cancelledAt ?? null,
    lastActivityAt: access?.lastActivityAt ?? null,
    deletionEligibleAt: access?.deletionEligibleAt ?? null,
    retentionDays: ACCOUNT_RETENTION_DAYS,
    expired,
  };
}

export async function cancelAccount(ownerClerkUserId: string) {
  const now = new Date();
  const [updated] = await db
    .update(accountAccessTable)
    .set({
      lifecycleStatus: "cancelled",
      cancelledAt: now,
      lastActivityAt: now,
      deletionEligibleAt: addRetentionWindow(now),
      purgeStartedAt: null,
      purgeError: null,
      updatedAt: now,
    })
    .where(and(
      eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId),
      eq(accountAccessTable.lifecycleStatus, "active"),
    ))
    .returning();
  if (updated) return getAccountLifecycleSnapshot(ownerClerkUserId);

  const [existing] = await db
    .select({ id: accountAccessTable.id })
    .from(accountAccessTable)
    .where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId))
    .limit(1);
  return existing ? getAccountLifecycleSnapshot(ownerClerkUserId) : null;
}

export async function reactivateAccount(ownerClerkUserId: string) {
  const now = new Date();
  const [updated] = await db
    .update(accountAccessTable)
    .set({
      lifecycleStatus: "active",
      cancelledAt: null,
      deletionEligibleAt: null,
      purgeStartedAt: null,
      purgeError: null,
      lastActivityAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId),
      eq(accountAccessTable.lifecycleStatus, "cancelled"),
      gt(accountAccessTable.deletionEligibleAt, now),
    ))
    .returning();
  if (updated) return getAccountLifecycleSnapshot(ownerClerkUserId);

  const lifecycle = await getAccountLifecycleSnapshot(ownerClerkUserId);
  return lifecycle.status === "active" ? lifecycle : null;
}

export async function reactivateAccountFromEntitlement(ownerClerkUserId: string) {
  return reactivateAccount(ownerClerkUserId);
}

export async function isAccountActive(ownerClerkUserId: string) {
  const lifecycle = await getAccountLifecycleSnapshot(ownerClerkUserId);
  return lifecycle.status === "active";
}