import { createClerkClient } from "@clerk/express";
import { and, count, eq, sql } from "drizzle-orm";
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
  environment?: "production" | "development";
};

type VerifiedEmailUser = {
  emailAddresses: Array<{
    emailAddress: string;
    verification: { status: string } | null;
  }>;
};

export const ADMIN_MEMBERSHIP_LOCK_KEY = "pixl-admin-membership";

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

function previewBootstrapConfig(): BootstrapConfig {
  const email = process.env.PIXL_PREVIEW_ADMIN_EMAIL?.trim().toLowerCase() || null;
  return {
    enabled: process.env.NODE_ENV === "development"
      && Boolean(process.env.CLERK_SECRET_KEY?.startsWith("sk_test_"))
      && Boolean(email),
    email,
    environment: "development",
  };
}

function hasVerifiedEmail(user: VerifiedEmailUser, email: string) {
  return user.emailAddresses.some((address) =>
    address.emailAddress.trim().toLowerCase() === email.trim().toLowerCase()
    && address.verification?.status === "verified");
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
  const environment = config.environment ?? "production";
  if (process.env.NODE_ENV !== environment || !config.enabled || !config.email) return false;

  const user = await getUser(clerkUserId);
  if (!hasVerifiedEmail(user, config.email)) return false;

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${ADMIN_MEMBERSHIP_LOCK_KEY}, 0))`);
    if (environment === "development") {
      const [existing] = await tx.select({ clerkUserId: adminUsersTable.clerkUserId })
        .from(adminUsersTable).where(eq(adminUsersTable.clerkUserId, clerkUserId)).limit(1);
      if (existing) return true;
      const [previousGrant] = await tx.select({ id: adminActionAuditTable.id })
        .from(adminActionAuditTable)
        .where(and(
          eq(adminActionAuditTable.targetClerkUserId, clerkUserId),
          eq(adminActionAuditTable.action, "initial_admin_bootstrapped"),
          eq(adminActionAuditTable.status, "completed"),
        )).limit(1);
      if (previousGrant) return false;
    }
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

export async function hasAdminAccess(
  clerkUserId: string,
  getUser: (id: string) => Promise<VerifiedEmailUser> = (id) => getAdminClerkClient().users.getUser(id),
) {
  if (process.env.NODE_ENV !== "production") {
    const config = previewBootstrapConfig();
    if (!config.enabled || !config.email) return false;
    const user = await getUser(clerkUserId);
    if (!hasVerifiedEmail(user, config.email)) return false;
    return bootstrapAdminForVerifiedUser(clerkUserId, config, async () => user);
  }
  if (await isAdminUser(clerkUserId)) return true;
  const config = productionBootstrapConfig();
  if (!config.enabled) return false;
  await bootstrapAdminForVerifiedUser(
    clerkUserId,
    config,
    getUser,
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