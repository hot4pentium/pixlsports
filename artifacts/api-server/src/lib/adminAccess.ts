import { createClerkClient } from "@clerk/express";
import { count, eq, sql } from "drizzle-orm";
import type { RequestHandler } from "express";
import {
  accountAccessTable,
  adminActionAuditTable,
  adminUsersTable,
  db,
} from "@workspace/db";
import { getOptionalClerkUserId } from "../middlewares/requireAuth";

type BootstrapConfig = {
  enabled: boolean;
  email: string | null;
};

type VerifiedEmailUser = {
  emailAddresses: Array<{
    emailAddress: string;
    verification: { status: string } | null;
  }>;
};

function productionBootstrapConfig(): BootstrapConfig {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const email = process.env.PIXL_INITIAL_ADMIN_EMAIL?.trim().toLowerCase() || null;
  return {
    enabled: process.env.NODE_ENV === "production"
      && Boolean(secretKey)
      && !secretKey!.startsWith("sk_test_")
      && Boolean(email),
    email,
  };
}

export function getAdminClerkClient() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY is required for member administration");
  return createClerkClient({ secretKey });
}

export async function bootstrapAdminForVerifiedUser(
  clerkUserId: string,
  config: BootstrapConfig,
  getUser: (id: string) => Promise<VerifiedEmailUser>,
) {
  if (!config.enabled || !config.email) return false;

  const user = await getUser(clerkUserId);
  const hasVerifiedBootstrapEmail = user.emailAddresses.some((emailAddress) =>
    emailAddress.emailAddress.trim().toLowerCase() === config.email
    && emailAddress.verification?.status === "verified");
  if (!hasVerifiedBootstrapEmail) return false;

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${clerkUserId}, 0))`);
    const [access] = await tx.select({
      lifecycleStatus: accountAccessTable.lifecycleStatus,
      deletionEligibleAt: accountAccessTable.deletionEligibleAt,
    }).from(accountAccessTable)
      .where(eq(accountAccessTable.ownerClerkUserId, clerkUserId))
      .limit(1);
    if (
      access?.lifecycleStatus === "deletion_pending"
      || (access?.lifecycleStatus === "cancelled"
        && access.deletionEligibleAt
        && access.deletionEligibleAt.getTime() <= Date.now())
    ) return false;
    const [created] = await tx.insert(adminUsersTable)
      .values({ clerkUserId })
      .onConflictDoNothing()
      .returning({ clerkUserId: adminUsersTable.clerkUserId });
    if (!created) return true;
    await tx.insert(adminActionAuditTable).values({
      actorClerkUserId: clerkUserId,
      targetClerkUserId: clerkUserId,
      action: "initial_admin_bootstrapped",
      status: "completed",
      changedFields: [],
      completedAt: new Date(),
    });
    return true;
  });
}

export async function isAdminUser(clerkUserId: string) {
  const [row] = await db.select({ clerkUserId: adminUsersTable.clerkUserId })
    .from(adminUsersTable)
    .where(eq(adminUsersTable.clerkUserId, clerkUserId))
    .limit(1);
  return Boolean(row);
}

export async function isLastAdmin(clerkUserId: string) {
  if (!await hasAdminAccess(clerkUserId)) return false;
  const [adminCount] = await db.select({ value: count() }).from(adminUsersTable);
  return Number(adminCount.value) <= 1;
}

export async function hasAdminAccess(clerkUserId: string) {
  if (await isAdminUser(clerkUserId)) return true;
  const config = productionBootstrapConfig();
  if (!config.enabled) return false;
  const clerk = getAdminClerkClient();
  await bootstrapAdminForVerifiedUser(
    clerkUserId,
    config,
    (id) => clerk.users.getUser(id),
  );
  return isAdminUser(clerkUserId);
}

export const requireAdmin: RequestHandler = async (req, res, next): Promise<void> => {
  const userId = getOptionalClerkUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  res.locals.clerkUserId = userId;
  try {
    if (!await hasAdminAccess(userId)) {
      res.status(403).json({ error: "Administrator access is required." });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
};

export const requireAuthenticatedAdminIdentity: RequestHandler = async (req, res, next): Promise<void> => {
  const userId = getOptionalClerkUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.locals.clerkUserId = userId;
  next();
};