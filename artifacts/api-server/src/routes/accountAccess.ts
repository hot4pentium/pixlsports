import { and, count, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Router, type IRouter } from "express";
import {
  ConsumeAccountUsageBody,
  ConsumeAccountUsageResponse,
  GetAccountAccessResponse,
  UpdateAccountAccessBody,
  UpdateAccountAccessResponse,
} from "@workspace/api-zod";
import {
  adminIdentityBlocksTable,
  accountAccessTable,
  db,
  guestUsageEventsTable,
  pool,
  projectMediaTable,
} from "@workspace/db";
import { getRequiredClerkUserId, requireAuth, requireAuthenticatedIdentity } from "../middlewares/requireAuth";
import { getAccountLifecycleSnapshot, hasActivePaidEntitlement, PROJECT_MEDIA_QUOTA_BYTES } from "../lib/accountLifecycle";
import {
  getClerkUserIdsByVerifiedEmails,
  getInitialAccountSetup,
  markAccountProvisioned,
} from "../lib/accountProvisioning";

const router: IRouter = Router();

export const GUEST_LIMITS = {
  hypeCards: 3,
  scheduleEvents: 3,
  lineups: 1,
} as const;

type UsageCategory = "hype_card" | "schedule_event" | "lineup";

function emptyUsage() {
  return {
    hypeCards: 0,
    scheduleEvents: 0,
    lineups: 0,
  };
}

function usageField(category: UsageCategory): keyof ReturnType<typeof emptyUsage> {
  if (category === "hype_card") return "hypeCards";
  if (category === "schedule_event") return "scheduleEvents";
  return "lineups";
}

async function usageForUser(ownerClerkUserId: string) {
  const grouped = await db
    .select({
      category: guestUsageEventsTable.category,
      value: count(),
    })
    .from(guestUsageEventsTable)
    .where(eq(guestUsageEventsTable.ownerClerkUserId, ownerClerkUserId))
    .groupBy(guestUsageEventsTable.category);

  const usage = emptyUsage();
  for (const row of grouped) {
    if (row.category === "hype_card") usage.hypeCards = Number(row.value);
    if (row.category === "schedule_event") usage.scheduleEvents = Number(row.value);
    if (row.category === "lineup") usage.lineups = Number(row.value);
  }
  return usage;
}

export async function getAccountAccessSnapshot(ownerClerkUserId: string) {
  const [access] = await db.transaction(async (tx) => {
    await tx
      .update(accountAccessTable)
      .set({ role: "fan", updatedAt: new Date() })
      .where(and(
        eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId),
        isNotNull(accountAccessTable.role),
        ne(accountAccessTable.role, "fan"),
      ));
    return tx
      .select()
      .from(accountAccessTable)
      .where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId))
      .limit(1);
  });
  const usage = await usageForUser(ownerClerkUserId);
  const [storage] = await db
    .select({ bytes: sql<number>`coalesce(sum(${projectMediaTable.size}), 0)` })
    .from(projectMediaTable)
    .where(eq(projectMediaTable.ownerClerkUserId, ownerClerkUserId));
  const limits = { ...GUEST_LIMITS };
  const remaining = {
    hypeCards: Math.max(0, limits.hypeCards - usage.hypeCards),
    scheduleEvents: Math.max(0, limits.scheduleEvents - usage.scheduleEvents),
    lineups: Math.max(0, limits.lineups - usage.lineups),
  };

  return {
    accessMode: access?.accessMode === "guest" ? "guest" as const : "full" as const,
    role: access?.role === "fan" ? "fan" : null,
    usage,
    remaining,
    limits,
    paid: await hasActivePaidEntitlement(ownerClerkUserId),
    storage: {
      usedBytes: Number(storage?.bytes ?? 0),
      limitBytes: PROJECT_MEDIA_QUOTA_BYTES,
    },
  };
}

export async function isFullAccount(ownerClerkUserId: string) {
  const snapshot = await getAccountAccessSnapshot(ownerClerkUserId);
  return snapshot.accessMode === "full";
}

async function consumeGuestUsage(
  ownerClerkUserId: string,
  category: UsageCategory,
  usageKey: string,
) {
  return consumeGuestUsageBatch(ownerClerkUserId, category, [usageKey]);
}

export async function consumeGuestUsageBatch(
  ownerClerkUserId: string,
  category: UsageCategory,
  usageKeys: string[],
) {
  const uniqueUsageKeys = [...new Set(usageKeys.filter((key) => key.trim().length > 0))];
  if (uniqueUsageKeys.length === 0) {
    return { allowed: true, snapshot: await getAccountAccessSnapshot(ownerClerkUserId) };
  }

  const [access] = await db
    .select()
    .from(accountAccessTable)
    .where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId))
    .limit(1);

  if (access?.accessMode !== "guest") {
    return { allowed: true, snapshot: await getAccountAccessSnapshot(ownerClerkUserId) };
  }

  const field = usageField(category);
  const limit = GUEST_LIMITS[field];
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT id
      FROM ${accountAccessTable}
      WHERE owner_clerk_user_id = ${ownerClerkUserId}
      FOR UPDATE
    `);
    const inserted = await tx
      .insert(guestUsageEventsTable)
      .values(uniqueUsageKeys.map((usageKey) => ({ ownerClerkUserId, category, usageKey })))
      .onConflictDoNothing({
        target: [
          guestUsageEventsTable.ownerClerkUserId,
          guestUsageEventsTable.category,
          guestUsageEventsTable.usageKey,
        ],
      })
      .returning({ id: guestUsageEventsTable.id });

    const [{ value }] = await tx
      .select({ value: count() })
      .from(guestUsageEventsTable)
      .where(and(
        eq(guestUsageEventsTable.ownerClerkUserId, ownerClerkUserId),
        eq(guestUsageEventsTable.category, category),
      ));
    const currentCount = Number(value);

    if (inserted.length > 0 && currentCount > limit) {
      await tx
        .delete(guestUsageEventsTable)
        .where(and(
          eq(guestUsageEventsTable.ownerClerkUserId, ownerClerkUserId),
          eq(guestUsageEventsTable.category, category),
          // Only remove keys inserted by this request. Existing usage is preserved.
          // The inserted row ids are selected from the same transaction.
          eq(guestUsageEventsTable.id, inserted[0].id),
        ));
      if (inserted.length > 1) {
        for (const row of inserted.slice(1)) {
          await tx.delete(guestUsageEventsTable).where(eq(guestUsageEventsTable.id, row.id));
        }
      }
      return false;
    }

    return true;
  });

  return {
    allowed: result,
    snapshot: await getAccountAccessSnapshot(ownerClerkUserId),
  };
}

type AccountProvisioning = {
  getInitialAccountSetup: typeof getInitialAccountSetup;
  getClerkUserIdsByVerifiedEmails: typeof getClerkUserIdsByVerifiedEmails;
  markAccountProvisioned: typeof markAccountProvisioned;
};

export function createAccountAccessRouter(
  provisioning: AccountProvisioning = {
    getInitialAccountSetup,
    getClerkUserIdsByVerifiedEmails,
    markAccountProvisioned,
  },
) {
  const router: IRouter = Router();

  router.get("/account/access", requireAuth, async (_req, res): Promise<void> => {
    const ownerClerkUserId = getRequiredClerkUserId(res);
    res.json(GetAccountAccessResponse.parse(await getAccountAccessSnapshot(ownerClerkUserId)));
  });

  router.put("/account/access", requireAuthenticatedIdentity, async (req, res): Promise<void> => {
    const parsed = UpdateAccountAccessBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const ownerClerkUserId = getRequiredClerkUserId(res);
    const lifecycle = await getAccountLifecycleSnapshot(ownerClerkUserId, { touchCancelledActivity: true });
    if (lifecycle.identityBlocked) {
      res.status(423).json({
        error: "Pixl Sports access is blocked for this sign-in.",
        code: "ACCOUNT_IDENTITY_BLOCKED",
      });
      return;
    }
    if (lifecycle.adminSuspended) {
      res.status(423).json({
        error: "This account is temporarily suspended by an administrator.",
        code: "ACCOUNT_ADMIN_SUSPENDED",
      });
      return;
    }
    let initialSetup: Awaited<ReturnType<AccountProvisioning["getInitialAccountSetup"]>> | null = null;
    if (lifecycle.status === "not_provisioned") {
      try {
        initialSetup = await provisioning.getInitialAccountSetup(ownerClerkUserId);
      } catch (error) {
        req.log.warn({ error, ownerClerkUserId }, "Could not verify first-time account setup");
        res.status(503).json({ error: "Account setup could not be verified. Please try again." });
        return;
      }
      if (!initialSetup.eligible) {
        res.status(423).json({
          error: "This sign-in cannot create a new app account.",
          code: "ACCOUNT_NOT_PROVISIONED",
        });
        return;
      }
      if (initialSetup.verifiedEmails.length === 0) {
        res.status(423).json({
          error: "Verify an email address with your sign-in provider before setting up your account.",
          code: "EMAIL_VERIFICATION_REQUIRED",
        });
        return;
      }
    } else if (lifecycle.status !== "active") {
      res.status(423).json({
        error: lifecycle.expired
          ? "Account recovery window has expired."
          : lifecycle.status === "paused" ? "Account is paused." : "Account is cancelled and locked.",
        code: lifecycle.expired ? "ACCOUNT_EXPIRED" : lifecycle.status === "paused" ? "ACCOUNT_PAUSED" : "ACCOUNT_LOCKED",
      });
      return;
    }

    const lockClient = await pool.connect();
    const lockDb = drizzle(lockClient);
    const acquiredLocks: string[] = [];
    let saveResult: "saved" | "email_already_in_use" | "account_mode_fixed" | "identity_blocked";

    try {
      const lockNames = [
        `account-access-owner:${ownerClerkUserId}`,
        ...(initialSetup?.verifiedEmails.map((email) => `account-provision-email:${email}`) ?? []),
      ].sort();
      for (const lockName of lockNames) {
        await lockClient.query(
          "SELECT pg_advisory_lock(hashtextextended($1, 0))",
          [lockName],
        );
        acquiredLocks.push(lockName);
      }

      let matchingClerkUserIds: string[] = [];
      if (initialSetup) {
        try {
          matchingClerkUserIds = await provisioning.getClerkUserIdsByVerifiedEmails(initialSetup.verifiedEmails);
        } catch (error) {
          req.log.warn(
            {
              ownerClerkUserId,
              errorType: error instanceof Error ? error.name : "UnknownError",
            },
            "Could not check existing verified email ownership",
          );
          res.status(503).json({ error: "Account setup could not be verified. Please try again." });
          return;
        }
      }

      const otherMatchingUserIds = matchingClerkUserIds.filter((userId) => userId !== ownerClerkUserId);
      saveResult = await lockDb.transaction(async (tx) => {
        if (initialSetup) {
          const [identityBlock] = await tx
            .select({ clerkUserId: adminIdentityBlocksTable.clerkUserId })
            .from(adminIdentityBlocksTable)
            .where(eq(adminIdentityBlocksTable.clerkUserId, ownerClerkUserId))
            .limit(1);
          if (identityBlock) return "identity_blocked";
        }
        if (otherMatchingUserIds.length > 0) {
          const [existingOwner] = await tx
            .select({ ownerClerkUserId: accountAccessTable.ownerClerkUserId })
            .from(accountAccessTable)
            .where(inArray(accountAccessTable.ownerClerkUserId, otherMatchingUserIds))
            .limit(1);
          if (existingOwner) return "email_already_in_use";
        }

        const [existingAccess] = await tx
          .select()
          .from(accountAccessTable)
          .where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId))
          .limit(1);
        if (existingAccess && existingAccess.accessMode !== parsed.data.accessMode) {
          return "account_mode_fixed";
        }

        await tx
          .insert(accountAccessTable)
          .values({
            ownerClerkUserId,
            role: parsed.data.role,
            accessMode: parsed.data.accessMode,
          })
          .onConflictDoUpdate({
            target: accountAccessTable.ownerClerkUserId,
            set: {
              role: parsed.data.role,
              accessMode: parsed.data.accessMode,
              updatedAt: new Date(),
            },
          });
        return "saved";
      });
    } finally {
      let unlockError: Error | undefined;
      for (const lockName of acquiredLocks.reverse()) {
        try {
          await lockClient.query(
            "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
            [lockName],
          );
        } catch (error) {
          unlockError = error instanceof Error ? error : new Error("Failed to release account setup lock");
          req.log.warn(
            { errorType: unlockError.name, lockCount: acquiredLocks.length },
            "Could not release account setup lock cleanly",
          );
          break;
        }
      }
      lockClient.release(unlockError);
    }

    if (saveResult === "identity_blocked") {
      res.status(423).json({
        error: "Pixl Sports access is blocked for this sign-in.",
        code: "ACCOUNT_IDENTITY_BLOCKED",
      });
      return;
    }
    if (saveResult === "email_already_in_use") {
      res.status(409).json({
        error: "This verified email is already linked to an app account. Sign in or recover that account instead.",
        code: "ACCOUNT_EMAIL_ALREADY_IN_USE",
      });
      return;
    }
    if (saveResult === "account_mode_fixed") {
      res.status(409).json({
        error: "Account mode cannot be changed after setup.",
        code: "ACCOUNT_MODE_FIXED",
      });
      return;
    }

    try {
      await provisioning.markAccountProvisioned(ownerClerkUserId);
    } catch (error) {
      req.log.warn({ error, ownerClerkUserId }, "Could not persist account provisioning marker");
    }

    res.json(UpdateAccountAccessResponse.parse(await getAccountAccessSnapshot(ownerClerkUserId)));
  });

  router.post("/account/usage", requireAuth, async (req, res): Promise<void> => {
    const parsed = ConsumeAccountUsageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const ownerClerkUserId = getRequiredClerkUserId(res);
    const result = await consumeGuestUsage(
      ownerClerkUserId,
      parsed.data.category,
      parsed.data.usageKey,
    );
    if (!result.allowed) {
      res.status(409).json({
        error: "Workspace allowance reached. Use existing work or contact support.",
      });
      return;
    }

    res.json(ConsumeAccountUsageResponse.parse(result.snapshot));
  });

  return router;
}

export default createAccountAccessRouter();