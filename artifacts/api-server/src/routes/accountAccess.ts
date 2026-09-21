import { and, count, eq, isNotNull, ne, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  ConsumeAccountUsageBody,
  ConsumeAccountUsageResponse,
  GetAccountAccessResponse,
  UpdateAccountAccessBody,
  UpdateAccountAccessResponse,
} from "@workspace/api-zod";
import {
  accountAccessTable,
  db,
  guestUsageEventsTable,
  projectMediaTable,
} from "@workspace/db";
import { getRequiredClerkUserId, requireAuth } from "../middlewares/requireAuth";
import { hasActivePaidEntitlement, PROJECT_MEDIA_QUOTA_BYTES } from "../lib/accountLifecycle";

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

router.get("/account/access", requireAuth, async (_req, res): Promise<void> => {
  const ownerClerkUserId = getRequiredClerkUserId(res);
  res.json(GetAccountAccessResponse.parse(await getAccountAccessSnapshot(ownerClerkUserId)));
});

router.put("/account/access", requireAuth, async (req, res): Promise<void> => {
  const parsed = UpdateAccountAccessBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const ownerClerkUserId = getRequiredClerkUserId(res);
  const [existingAccess] = await db
    .select()
    .from(accountAccessTable)
    .where(eq(accountAccessTable.ownerClerkUserId, ownerClerkUserId))
    .limit(1);
  if (existingAccess && existingAccess.accessMode !== parsed.data.accessMode) {
    res.status(409).json({
      error: "Account mode cannot be changed after setup.",
    });
    return;
  }
  await db
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

export default router;