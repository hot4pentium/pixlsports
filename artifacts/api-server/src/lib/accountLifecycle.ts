import { and, desc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { accountAccessTable, accountEntitlementEventsTable, db } from "@workspace/db";

export const ACCOUNT_RETENTION_DAYS = 90;
export const PROJECT_MEDIA_QUOTA_BYTES = 1024 * 1024 * 1024;
const ACCOUNT_RETENTION_MS = ACCOUNT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export type AccountLifecycleStatus = "active" | "paused" | "cancelled" | "deletion_pending" | "not_provisioned";

export type PaidEntitlement = {
  providerEventId: string;
  ownerClerkUserId: string;
  expiresAt: Date;
  planTier?: "plus" | "pro";
};

function asStatus(value: string | null | undefined): AccountLifecycleStatus {
  if (value === null || value === undefined) return "not_provisioned";
  if (value === "paused" || value === "cancelled" || value === "deletion_pending") return value;
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
  if (!access) {
    return {
      status: "not_provisioned" as const,
      pauseEndsAt: null,
      planTier: "free" as const,
      cancelledAt: null,
      lastActivityAt: null,
      deletionEligibleAt: null,
      retentionDays: ACCOUNT_RETENTION_DAYS,
      expired: false,
      adminSuspended: false,
    };
  }

  if (access?.lifecycleStatus === "paused" && access.pauseEndsAt && access.pauseEndsAt <= now) {
    const [resumed] = await db.update(accountAccessTable)
      .set({ lifecycleStatus: "active", pauseEndsAt: null, updatedAt: now })
      .where(and(
        eq(accountAccessTable.id, access.id),
        eq(accountAccessTable.lifecycleStatus, "paused"),
        lte(accountAccessTable.pauseEndsAt, now),
      )).returning();
    if (resumed) access = resumed;
    else [access] = await db.select().from(accountAccessTable)
      .where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId)).limit(1);
  }
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

  const [entitlement] = await db.select({ planTier: accountEntitlementEventsTable.planTier })
    .from(accountEntitlementEventsTable)
    .where(and(
      eq(accountEntitlementEventsTable.ownerClerkUserId, ownerClerkUserId),
      gt(accountEntitlementEventsTable.entitlementExpiresAt, now),
    ))
    .orderBy(desc(sql`case when ${accountEntitlementEventsTable.planTier} = 'pro' then 1 else 0 end`), desc(accountEntitlementEventsTable.entitlementExpiresAt))
    .limit(1);

  return {
    status: asStatus(access?.lifecycleStatus),
    pauseEndsAt: access?.pauseEndsAt ?? null,
    planTier: entitlement?.planTier === "pro" ? "pro" as const : entitlement ? "plus" as const : "free" as const,
    cancelledAt: access?.cancelledAt ?? null,
    lastActivityAt: access?.lastActivityAt ?? null,
    deletionEligibleAt: access?.deletionEligibleAt ?? null,
    retentionDays: ACCOUNT_RETENTION_DAYS,
    expired,
    adminSuspended: Boolean(access?.adminSuspendedAt),
  };
}

export async function pauseAccount(ownerClerkUserId: string) {
  const now = new Date();
  const [updated] = await db.update(accountAccessTable).set({
    lifecycleStatus: "paused",
    pauseEndsAt: addRetentionWindow(now),
    updatedAt: now,
  }).where(and(
    eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId),
    eq(accountAccessTable.lifecycleStatus, "active"),
    isNull(accountAccessTable.adminSuspendedAt),
  )).returning();
  if (updated) return getAccountLifecycleSnapshot(ownerClerkUserId);
  const lifecycle = await getAccountLifecycleSnapshot(ownerClerkUserId);
  return lifecycle.status === "paused" && !lifecycle.adminSuspended ? lifecycle : null;
}

export async function resumeAccount(ownerClerkUserId: string) {
  const now = new Date();
  const [updated] = await db.update(accountAccessTable).set({
    lifecycleStatus: "active",
    pauseEndsAt: null,
    updatedAt: now,
  }).where(and(
    eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId),
    eq(accountAccessTable.lifecycleStatus, "paused"),
    isNull(accountAccessTable.adminSuspendedAt),
  )).returning();
  if (updated) return getAccountLifecycleSnapshot(ownerClerkUserId);
  return null;
}

export async function cancelAccount(ownerClerkUserId: string) {
  const current = await getAccountLifecycleSnapshot(ownerClerkUserId);
  if (current.adminSuspended) return null;
  const now = new Date();
  const [updated] = await db
    .update(accountAccessTable)
    .set({
      lifecycleStatus: "cancelled",
      pauseEndsAt: null,
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
      isNull(accountAccessTable.adminSuspendedAt),
    ))
    .returning();
  if (updated) return getAccountLifecycleSnapshot(ownerClerkUserId);

  const [existing] = await db
    .select({ id: accountAccessTable.id })
    .from(accountAccessTable)
    .where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId))
    .limit(1);
  if (!existing) return null;
  const lifecycle = await getAccountLifecycleSnapshot(ownerClerkUserId);
  return lifecycle.adminSuspended ? null : lifecycle;
}

export async function reactivateAccount(ownerClerkUserId: string) {
  const current = await getAccountLifecycleSnapshot(ownerClerkUserId);
  if (current.adminSuspended) return null;
  const now = new Date();
  const [updated] = await db
    .update(accountAccessTable)
    .set({
      lifecycleStatus: "active",
      pauseEndsAt: null,
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
      isNull(accountAccessTable.adminSuspendedAt),
    ))
    .returning();
  if (updated) return getAccountLifecycleSnapshot(ownerClerkUserId);

  const [existing] = await db
    .select({ id: accountAccessTable.id })
    .from(accountAccessTable)
    .where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId))
    .limit(1);
  if (!existing) return null;

  const lifecycle = await getAccountLifecycleSnapshot(ownerClerkUserId);
  return lifecycle.status === "active" && !lifecycle.adminSuspended ? lifecycle : null;
}

export async function reactivateAccountFromEntitlement(entitlement: PaidEntitlement) {
  if (!Number.isFinite(entitlement.expiresAt.getTime())) {
    throw new Error("Paid entitlement expiration is invalid");
  }

  const [recordedEvent] = await db
    .insert(accountEntitlementEventsTable)
    .values({
      providerEventId: entitlement.providerEventId,
      ownerClerkUserId: entitlement.ownerClerkUserId,
      entitlementExpiresAt: entitlement.expiresAt,
      planTier: entitlement.planTier ?? "plus",
    })
    .onConflictDoNothing({
      target: accountEntitlementEventsTable.providerEventId,
    })
    .returning({ id: accountEntitlementEventsTable.id });

  if (!recordedEvent) {
    return {
      lifecycle: await getAccountLifecycleSnapshot(entitlement.ownerClerkUserId),
      replayed: true,
      restored: false,
    };
  }

  const lifecycle = entitlement.expiresAt.getTime() > Date.now()
    ? await reactivateAccount(entitlement.ownerClerkUserId)
    : await getAccountLifecycleSnapshot(entitlement.ownerClerkUserId);

  return {
    lifecycle,
    replayed: false,
    restored: lifecycle?.status === "active",
  };
}

export async function isAccountActive(ownerClerkUserId: string) {
  const lifecycle = await getAccountLifecycleSnapshot(ownerClerkUserId);
  return lifecycle.status === "active" && !lifecycle.adminSuspended;
}

/** Paid is derived only from the signed entitlement ledger, never accessMode. */
export async function hasActivePaidEntitlement(ownerClerkUserId: string, now = new Date()) {
  const lifecycle = await getAccountLifecycleSnapshot(ownerClerkUserId);
  if (lifecycle.status !== "active" || lifecycle.adminSuspended) return false;
  const [entitlement] = await db
    .select({ expiresAt: accountEntitlementEventsTable.entitlementExpiresAt })
    .from(accountEntitlementEventsTable)
    .where(and(
      eq(accountEntitlementEventsTable.ownerClerkUserId, ownerClerkUserId),
      gt(accountEntitlementEventsTable.entitlementExpiresAt, now),
    ))
    .orderBy(desc(accountEntitlementEventsTable.entitlementExpiresAt))
    .limit(1);
  return Boolean(entitlement);
}