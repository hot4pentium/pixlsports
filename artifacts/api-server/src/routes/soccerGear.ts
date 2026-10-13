import { and, eq, gt, isNull } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { GetSoccerGearResponse, RecordSoccerGearShareActionBody, SaveSoccerGearBody } from "@workspace/api-zod";
import { athleteInvitesTable, db, hypeCardSharesTable, soccerGearActivityTable, soccerGearLooksTable } from "@workspace/db";
import { getRequiredClerkUserId, requireAuth } from "../middlewares/requireAuth";
import { creditExistingSoccerEventCards, creditExistingSoccerTrackerGames, readSoccerGear } from "../lib/soccerGear";
import { lockedSoccerSelection, soccerWeekKey } from "../lib/soccerGearPolicy";

const router: IRouter = Router();
router.use("/athlete-gear", requireAuth, (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.get("/athlete-gear/soccer", async (_req, res, next) => {
  try {
    const owner = getRequiredClerkUserId(res);
    await Promise.all([
      creditExistingSoccerEventCards(owner),
      creditExistingSoccerTrackerGames(owner),
    ]);
    res.json(GetSoccerGearResponse.parse(await readSoccerGear(owner)));
  }
  catch (error) { next(error); }
});

router.put("/athlete-gear/soccer", async (req, res, next) => {
  const parsed = SaveSoccerGearBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Choose valid soccer gear and colors." }); return; }
  try {
    const owner = getRequiredClerkUserId(res);
    const result = await db.transaction(async (tx) => {
      const [invite] = await tx.select().from(athleteInvitesTable)
        .where(eq(athleteInvitesTable.ownerClerkUserId, owner)).for("update");
      if (!invite || invite.sport !== "soccer") return { error: "Create your soccer athlete's HYPE Card first." };
      if (invite.id !== parsed.data.athleteId) return { error: "The selected athlete changed. Refresh before saving this look." };
      const state = await readSoccerGear(owner, tx);
      const locked = lockedSoccerSelection(parsed.data.loadout, state.unlockedGear);
      if (locked) return { error: "This gear is still locked. Refresh your progress before equipping it." };
      await tx.insert(soccerGearLooksTable).values({
        inviteId: invite.id, loadout: parsed.data.loadout, showOnHypeCard: parsed.data.showOnHypeCard,
      }).onConflictDoUpdate({
        target: soccerGearLooksTable.inviteId,
        set: { loadout: parsed.data.loadout, showOnHypeCard: parsed.data.showOnHypeCard, updatedAt: new Date() },
      });
      return { state: await readSoccerGear(owner, tx) };
    });
    if (result.error) { res.status(400).json({ error: result.error }); return; }
    res.json(GetSoccerGearResponse.parse(result.state));
  } catch (error) { next(error); }
});

router.post("/athlete-gear/soccer/activity", async (_req, res, next) => {
  try {
    const owner = getRequiredClerkUserId(res);
    await db.insert(soccerGearActivityTable).values({
      ownerClerkUserId: owner, kind: "week", eventKey: soccerWeekKey(new Date()),
    }).onConflictDoNothing();
    res.json(GetSoccerGearResponse.parse(await readSoccerGear(owner)));
  } catch (error) { next(error); }
});

router.post("/athlete-gear/soccer/share-action", async (req, res, next) => {
  const parsed = RecordSoccerGearShareActionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Choose an owned HYPE Card." }); return; }
  try {
    const owner = getRequiredClerkUserId(res);
    const token = parsed.data.shareToken;
    const now = new Date();
    const result = await db.transaction(async (tx) => {
      const [invite] = await tx.select().from(athleteInvitesTable).where(and(
        eq(athleteInvitesTable.ownerClerkUserId, owner), eq(athleteInvitesTable.publicToken, token),
        eq(athleteInvitesTable.paused, false),
      )).for("update");
      const [share] = invite ? [] : await tx.select().from(hypeCardSharesTable).where(and(
        eq(hypeCardSharesTable.ownerClerkUserId, owner), eq(hypeCardSharesTable.publicToken, token),
        isNull(hypeCardSharesTable.revokedAt), gt(hypeCardSharesTable.expiresAt, now),
      )).for("update");
      if (!invite && !share) return null;
      await tx.insert(soccerGearActivityTable).values({
        ownerClerkUserId: owner, kind: "share", eventKey: "completed",
      }).onConflictDoNothing();
      return readSoccerGear(owner, tx);
    });
    if (!result) { res.status(404).json({ error: "This owned HYPE Card is no longer active." }); return; }
    res.json(GetSoccerGearResponse.parse(result));
  } catch (error) { next(error); }
});

export default router;
