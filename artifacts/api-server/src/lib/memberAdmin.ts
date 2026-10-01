import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import {
  accountAccessTable,
  adminActionAuditTable,
  adminUsersTable,
  db,
} from "@workspace/db";
import { getAdminClerkClient, isAdminUser } from "./adminAccess";
import { runExpiredAccountPurge } from "../jobs/purgeCancelledAccounts";

const PROFILE_FIELDS = [
  "displayName",
  "teamName",
  "seasonName",
  "athleteName",
  "jerseyNumber",
  "position",
  "relationship",
  "sport",
] as const;

const PROFILE_TEXT_LIMITS = {
  displayName: 100,
  teamName: 100,
  seasonName: 100,
  athleteName: 100,
  jerseyNumber: 20,
  position: 60,
  relationship: 60,
} as const;

const SUPPORTED_SPORTS = new Set(["baseball", "basketball", "football", "soccer", "volleyball"]);
const MEMBER_STATUSES = new Set(["active", "paused", "cancelled", "deletion_pending"]);
const AUDIT_STATUSES = new Set(["pending", "failed", "completed"]);
const AUDIT_ACTIONS = new Set([
  "initial_admin_bootstrapped",
  "profile_updated",
  "account_suspended",
  "account_reactivated",
  "account_deleted",
]);

export class AdminRequestError extends Error {
  constructor(
    public readonly statusCode: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "AdminRequestError";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function readMemberProfile(metadata: unknown) {
  const values = asRecord(metadata);
  return {
    displayName: boundedString(values.displayName, PROFILE_TEXT_LIMITS.displayName),
    teamName: boundedString(values.teamName, PROFILE_TEXT_LIMITS.teamName),
    seasonName: boundedString(values.seasonName, PROFILE_TEXT_LIMITS.seasonName),
    athleteName: boundedString(values.athleteName, PROFILE_TEXT_LIMITS.athleteName),
    jerseyNumber: boundedString(values.jerseyNumber, PROFILE_TEXT_LIMITS.jerseyNumber),
    position: boundedString(values.position, PROFILE_TEXT_LIMITS.position),
    relationship: boundedString(values.relationship, PROFILE_TEXT_LIMITS.relationship),
    sport: typeof values.sport === "string" && SUPPORTED_SPORTS.has(values.sport)
      ? values.sport
      : null,
  };
}

function lifecycleStatus(value: string | undefined) {
  if (!value) return "not_provisioned";
  if (!MEMBER_STATUSES.has(value)) {
    throw new Error("Member account has an unsupported lifecycle status");
  }
  return value;
}

function toAdminMember(
  user: Awaited<ReturnType<ReturnType<typeof getAdminClerkClient>["users"]["getUser"]>>,
  access?: typeof accountAccessTable.$inferSelect,
  isAdministrator = false,
) {
  const createdAt = Number.isFinite(user.createdAt) ? new Date(user.createdAt).toISOString() : null;
  const primaryEmail = user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId)?.emailAddress ?? null;
  return {
    clerkUserId: user.id,
    primaryEmailAddress: primaryEmail,
    firstName: boundedString(user.firstName, 100),
    lastName: boundedString(user.lastName, 100),
    createdAt,
    role: access?.role === "fan" ? "fan" : null,
    accessMode: access?.accessMode === "full" || access?.accessMode === "guest" ? access.accessMode : null,
    lifecycleStatus: lifecycleStatus(access?.lifecycleStatus),
    adminSuspended: Boolean(access?.adminSuspendedAt),
    isAdministrator,
    profile: readMemberProfile(user.unsafeMetadata),
  };
}

function isClerkNotFound(error: unknown) {
  const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown };
  return candidate.status === 404
    || candidate.statusCode === 404
    || candidate.code === "resource_not_found";
}

async function getClerkUser(clerkUserId: string) {
  try {
    return await getAdminClerkClient().users.getUser(clerkUserId);
  } catch (error) {
    if (isClerkNotFound(error)) return null;
    throw error;
  }
}

async function accountAccessByIds(clerkUserIds: string[]) {
  if (!clerkUserIds.length) return new Map<string, typeof accountAccessTable.$inferSelect>();
  const rows = await db.select().from(accountAccessTable)
    .where(inArray(accountAccessTable.ownerClerkUserId, clerkUserIds));
  return new Map(rows.map((row) => [row.ownerClerkUserId, row]));
}

export async function listAdminMembers(options: { search?: string; limit: number; offset: number }) {
  const query = options.search?.trim() || undefined;
  const page = await getAdminClerkClient().users.getUserList({
    limit: options.limit,
    offset: options.offset,
    ...(query ? { query } : {}),
  });
  const userIds = page.data.map((user) => user.id);
  const [accounts, administrators] = await Promise.all([
    accountAccessByIds(userIds),
    userIds.length
      ? db.select({ clerkUserId: adminUsersTable.clerkUserId })
        .from(adminUsersTable)
        .where(inArray(adminUsersTable.clerkUserId, userIds))
      : Promise.resolve([]),
  ]);
  const administratorIds = new Set(administrators.map((row) => row.clerkUserId));
  return {
    items: page.data.map((user) => toAdminMember(
      user,
      accounts.get(user.id),
      administratorIds.has(user.id),
    )),
    totalCount: page.totalCount,
    limit: options.limit,
    offset: options.offset,
  };
}

export async function getAdminMember(clerkUserId: string) {
  const user = await getClerkUser(clerkUserId);
  if (!user) return null;
  const [access, administrator] = await Promise.all([
    db.select().from(accountAccessTable)
      .where(eq(accountAccessTable.ownerClerkUserId, clerkUserId))
      .limit(1)
      .then(([row]) => row),
    isAdminUser(clerkUserId),
  ]);
  return toAdminMember(user, access, administrator);
}

async function writeAudit(
  actorClerkUserId: string,
  targetClerkUserId: string,
  action: string,
  status: string,
  options: { changedFields?: string[]; reason?: string | null; failureCode?: string | null; completedAt?: Date | null } = {},
) {
  const [row] = await db.insert(adminActionAuditTable).values({
    actorClerkUserId,
    targetClerkUserId,
    action,
    status,
    changedFields: options.changedFields ?? [],
    reason: options.reason ?? null,
    failureCode: options.failureCode ?? null,
    completedAt: options.completedAt ?? null,
  }).returning();
  return row;
}

async function finishAudit(id: string, status: "failed" | "completed", failureCode: string | null = null) {
  await db.update(adminActionAuditTable).set({
    status,
    failureCode,
    completedAt: status === "completed" ? new Date() : null,
  }).where(eq(adminActionAuditTable.id, id));
}

export async function updateAdminMemberProfile(
  actorClerkUserId: string,
  targetClerkUserId: string,
  changes: Record<string, string | null | undefined>,
  dependencies: {
    getUser: typeof getClerkUser;
    updateUser: (targetClerkUserId: string, unsafeMetadata: Record<string, unknown>) => Promise<void>;
    getMember: typeof getAdminMember;
  } = {
    getUser: getClerkUser,
    updateUser: async (targetClerkUserId, unsafeMetadata) => {
      await getAdminClerkClient().users.updateUser(targetClerkUserId, { unsafeMetadata });
    },
    getMember: getAdminMember,
  },
) {
  const user = await dependencies.getUser(targetClerkUserId);
  if (!user) return null;
  const update = Object.fromEntries(
    PROFILE_FIELDS
      .filter((field) => Object.hasOwn(changes, field))
      .map((field) => {
        const value = changes[field];
        return [field, typeof value === "string" ? value.trim() : value];
      }),
  ) as Record<(typeof PROFILE_FIELDS)[number], string | null | undefined>;
  const changedFields = Object.keys(update);
  if (!changedFields.length) {
    throw new AdminRequestError(400, "Choose at least one supported profile field to update.");
  }

  const audit = await writeAudit(
    actorClerkUserId,
    targetClerkUserId,
    "profile_updated",
    "pending",
    { changedFields },
  );
  const unsafeMetadata = { ...asRecord(user.unsafeMetadata) };
  for (const field of PROFILE_FIELDS) {
    if (!Object.hasOwn(update, field)) continue;
    const value = update[field];
    if (typeof value !== "string" || value.trim() === "") {
      delete unsafeMetadata[field];
    } else {
      unsafeMetadata[field] = value.trim();
    }
  }

  try {
    await dependencies.updateUser(targetClerkUserId, unsafeMetadata);
    await finishAudit(audit.id, "completed");
  } catch (error) {
    await finishAudit(audit.id, "failed", "clerk_profile_update_failed");
    throw error;
  }
  return dependencies.getMember(targetClerkUserId);
}

export async function updateAdminMemberSuspension(
  actorClerkUserId: string,
  targetClerkUserId: string,
  suspended: boolean,
  reason?: string | null,
) {
  const now = new Date();
  const action = suspended ? "account_suspended" : "account_reactivated";
  const audit = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${targetClerkUserId}, 0))`);
    const [administrator] = await tx.select({ clerkUserId: adminUsersTable.clerkUserId })
      .from(adminUsersTable)
      .where(eq(adminUsersTable.clerkUserId, targetClerkUserId))
      .limit(1);
    if (administrator) {
      throw new AdminRequestError(409, "Administrator accounts cannot be suspended from member management.");
    }
    const whereCondition = suspended
      ? and(
        eq(accountAccessTable.ownerClerkUserId, targetClerkUserId),
        ne(accountAccessTable.lifecycleStatus, "deletion_pending"),
        isNull(accountAccessTable.adminSuspendedAt),
      )
      : and(
        eq(accountAccessTable.ownerClerkUserId, targetClerkUserId),
        isNotNull(accountAccessTable.adminSuspendedAt),
      );
    const [updated] = await tx.update(accountAccessTable).set(suspended
      ? {
        adminSuspendedAt: now,
        adminSuspendedByClerkUserId: actorClerkUserId,
        updatedAt: now,
      }
      : {
        adminSuspendedAt: null,
        adminSuspendedByClerkUserId: null,
        updatedAt: now,
      }).where(whereCondition).returning({ ownerClerkUserId: accountAccessTable.ownerClerkUserId });
    if (!updated) {
      const [existing] = await tx.select().from(accountAccessTable)
        .where(eq(accountAccessTable.ownerClerkUserId, targetClerkUserId))
        .limit(1);
      if (!existing) throw new AdminRequestError(404, "Member account was not found.");
      if (existing.lifecycleStatus === "deletion_pending") {
        throw new AdminRequestError(409, "A member account being deleted cannot be suspended or restored.");
      }
      throw new AdminRequestError(409, suspended
        ? "Only an active, unsuspended account can be suspended."
        : "This account is not currently suspended by an administrator.");
    }
    const [record] = await tx.insert(adminActionAuditTable).values({
      actorClerkUserId,
      targetClerkUserId,
      action,
      status: "completed",
      changedFields: suspended ? ["adminSuspendedAt"] : ["adminSuspendedAt", "adminSuspendedByClerkUserId"],
      reason: reason?.trim() || null,
      completedAt: now,
    }).returning();
    return record;
  });
  return {
    actionId: audit.id,
    action,
    status: "completed" as const,
    targetClerkUserId,
    message: suspended ? "Member account suspended." : "Administrator suspension removed.",
  };
}

export async function requestAdminMemberDeletion(
  actorClerkUserId: string,
  targetClerkUserId: string,
  confirmationText: string,
  reason: string,
  dependencies: {
    getUser: typeof getClerkUser;
    runPurge: (ownerClerkUserId: string) => Promise<void>;
  } = {
    getUser: getClerkUser,
    runPurge: (ownerClerkUserId) => runExpiredAccountPurge({ ownerClerkUserId }),
  },
) {
  if (await isAdminUser(targetClerkUserId)) {
    throw new AdminRequestError(409, "Administrator accounts cannot be deleted from member management.");
  }

  const user = await dependencies.getUser(targetClerkUserId);
  if (!user) return null;
  const primaryEmail = user.emailAddresses
    .find((email) => email.id === user.primaryEmailAddressId)?.emailAddress ?? null;
  const confirmation = confirmationText.trim().toLowerCase();
  const validConfirmations = [primaryEmail, targetClerkUserId]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
  if (!validConfirmations.includes(confirmation)) {
    throw new AdminRequestError(400, "Confirmation must exactly match the member's primary email address or user ID.");
  }

  const action = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${targetClerkUserId}, 0))`);
    const [administrator] = await tx.select({ clerkUserId: adminUsersTable.clerkUserId })
      .from(adminUsersTable)
      .where(eq(adminUsersTable.clerkUserId, targetClerkUserId))
      .limit(1);
    if (administrator) {
      throw new AdminRequestError(409, "Administrator accounts cannot be deleted from member management.");
    }
    const [existing] = await tx.select().from(accountAccessTable)
      .where(eq(accountAccessTable.ownerClerkUserId, targetClerkUserId))
      .limit(1);
    if (existing?.adminDeletionActionId) {
      const [previousAction] = await tx.select().from(adminActionAuditTable)
        .where(eq(adminActionAuditTable.id, existing.adminDeletionActionId))
        .limit(1);
      if (!previousAction) throw new Error("Member deletion audit record is missing");
      return previousAction;
    }
    if (existing?.lifecycleStatus === "deletion_pending") {
      throw new AdminRequestError(409, "This member already has a self-service deletion in progress.");
    }

    const [createdAction] = await tx.insert(adminActionAuditTable).values({
      actorClerkUserId,
      targetClerkUserId,
      action: "account_deleted",
      status: "pending",
      changedFields: [],
      reason: reason.trim(),
    }).returning();
    const now = new Date();
    if (existing) {
      const [updated] = await tx.update(accountAccessTable).set({
        lifecycleStatus: "deletion_pending",
        pauseEndsAt: null,
        cancelledAt: now,
        lastActivityAt: now,
        deletionEligibleAt: now,
        purgeStartedAt: null,
        purgeError: null,
        adminDeletionActionId: createdAction.id,
        updatedAt: now,
      }).where(and(
        eq(accountAccessTable.id, existing.id),
        isNull(accountAccessTable.adminDeletionActionId),
      )).returning({ id: accountAccessTable.id });
      if (!updated) throw new AdminRequestError(409, "Member account changed while deletion was being requested. Refresh and try again.");
    } else {
      await tx.insert(accountAccessTable).values({
        ownerClerkUserId: targetClerkUserId,
        role: "fan",
        accessMode: "full",
        lifecycleStatus: "deletion_pending",
        cancelledAt: now,
        lastActivityAt: now,
        deletionEligibleAt: now,
        adminDeletionActionId: createdAction.id,
      });
    }
    return createdAction;
  });

  await dependencies.runPurge(targetClerkUserId);
  const [currentAction] = await db.select().from(adminActionAuditTable)
    .where(eq(adminActionAuditTable.id, action.id))
    .limit(1);
  if (!currentAction) throw new Error("Member deletion audit record disappeared");
  return currentAction;
}

export async function getAdminAction(id: string) {
  const [action] = await db.select().from(adminActionAuditTable)
    .where(eq(adminActionAuditTable.id, id))
    .limit(1);
  return action ?? null;
}

export async function listAdminAudit(options: { limit: number; offset: number }) {
  const [total] = await db.select({ value: count() }).from(adminActionAuditTable);
  const rows = await db.select().from(adminActionAuditTable)
    .orderBy(desc(adminActionAuditTable.createdAt))
    .limit(options.limit)
    .offset(options.offset);
  return {
    items: rows.map((row) => ({
      id: row.id,
      actorClerkUserId: row.actorClerkUserId,
      targetClerkUserId: row.targetClerkUserId,
      action: AUDIT_ACTIONS.has(row.action) ? row.action : "profile_updated",
      status: AUDIT_STATUSES.has(row.status) ? row.status : "failed",
      changedFields: Array.isArray(row.changedFields) ? row.changedFields : [],
      reason: row.reason,
      failureCode: row.failureCode,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    })),
    totalCount: Number(total.value),
    limit: options.limit,
    offset: options.offset,
  };
}

export async function getAdminMemberActionResult(actionId: string, targetClerkUserId: string) {
  const action = await getAdminAction(actionId);
  if (!action) return null;
  const status = AUDIT_STATUSES.has(action.status) ? action.status : "failed";
  return {
    actionId: action.id,
    action: action.action === "account_deleted"
      ? "account_deleted"
      : action.action === "account_suspended" ? "account_suspended" : "account_reactivated",
    status,
    targetClerkUserId,
    message: status === "completed"
      ? "Member account and associated data were deleted."
      : status === "failed"
        ? "Cleanup failed. The system will retry automatically."
        : "Member account cleanup is in progress.",
  };
}