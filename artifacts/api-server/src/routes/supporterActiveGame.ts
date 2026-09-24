import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetSupporterActiveGameResponse,
  UpdateSupporterActiveGameBody,
  UpdateSupporterActiveGameResponse,
} from "@workspace/api-zod";
import { db, supporterActiveGamesTable } from "@workspace/db";
import { getRequiredClerkUserId, requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/supporter/active-game", requireAuth, async (_req, res): Promise<void> => {
  const ownerClerkUserId = getRequiredClerkUserId(res);
  const [selection] = await db
    .select({ gameId: supporterActiveGamesTable.gameId })
    .from(supporterActiveGamesTable)
    .where(eq(supporterActiveGamesTable.ownerClerkUserId, ownerClerkUserId))
    .limit(1);

  res.json(GetSupporterActiveGameResponse.parse({ gameId: selection?.gameId ?? null }));
});

router.put("/supporter/active-game", requireAuth, async (req, res): Promise<void> => {
  const parsed = UpdateSupporterActiveGameBody.safeParse(req.body);
  if (
    !parsed.success
    || !req.body
    || typeof req.body !== "object"
    || Array.isArray(req.body)
    || Object.keys(req.body).some((key) => key !== "gameId")
  ) {
    res.status(400).json({ error: parsed.success ? "Only a game ID may be saved." : parsed.error.message });
    return;
  }

  const ownerClerkUserId = getRequiredClerkUserId(res);
  if (parsed.data.gameId === null) {
    await db.delete(supporterActiveGamesTable)
      .where(eq(supporterActiveGamesTable.ownerClerkUserId, ownerClerkUserId));
    res.json(UpdateSupporterActiveGameResponse.parse({ gameId: null }));
    return;
  }

  const [selection] = await db
    .insert(supporterActiveGamesTable)
    .values({ ownerClerkUserId, gameId: parsed.data.gameId })
    .onConflictDoUpdate({
      target: supporterActiveGamesTable.ownerClerkUserId,
      set: { gameId: parsed.data.gameId, updatedAt: new Date() },
    })
    .returning({ gameId: supporterActiveGamesTable.gameId });

  res.json(UpdateSupporterActiveGameResponse.parse(selection));
});

export default router;