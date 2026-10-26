import { and, eq, gt, isNull } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { GetSoccerGearResponse, RecordSoccerGearShareActionBody, SaveSoccerGearBody } from "@workspace/api-zod";
import { athleteEditorAccessTable, athleteInvitesTable, cloudProjectsTable, db, hypeCardSharesTable, soccerGearActivityTable, soccerGearLooksTable, type AthleteEditorAccess } from "@workspace/db";
import { getRequiredClerkUserId, requireAuth, requireProjectEditorAuth } from "../middlewares/requireAuth";
import { readSoccerGear } from "../lib/soccerGear";
import { lockedSoccerSelection, soccerWeekKey } from "../lib/soccerGearPolicy";

const router: IRouter = Router();
const retiredGearResponse = (_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) => {
  res.status(410).json({
    error: "Jersey and gear features have been retired. Open the HYPE Card Showcase.",
    showcaseUrl: "/studio/player-showcase",
  });
};

router.all("/athlete-gear/soccer", retiredGearResponse);
router.all("/athlete-gear/soccer/activity", retiredGearResponse);
router.all("/athlete-gear/soccer/share-action", retiredGearResponse);
router.use("/athlete-gear", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

async function validLinkedKit(access: AthleteEditorAccess) {
  if (access.projectId === null) return false;
  const [linked] = await db.select({ project: cloudProjectsTable.project })
    .from(athleteInvitesTable)
    .innerJoin(cloudProjectsTable, and(
      eq(cloudProjectsTable.id, access.projectId),
      eq(cloudProjectsTable.ownerClerkUserId, access.ownerClerkUserId),
    ))
    .where(and(
      eq(athleteInvitesTable.id, access.athleteInviteId),
      eq(athleteInvitesTable.ownerClerkUserId, access.ownerClerkUserId),
      eq(athleteInvitesTable.sport, "soccer"),
    )).limit(1);
  return Boolean(linked?.project && typeof linked.project === "object"
    && (linked.project as Record<string, unknown>).tool === "hype-card");
}

router.get("/athlete-gear/soccer", requireProjectEditorAuth, async (_req, res, next) => {
  try {
    const access = res.locals.athleteEditorAccess as AthleteEditorAccess | undefined;
    if (access && !await validLinkedKit(access)) {
      res.status(403).json({ error: "The linked athlete kit is no longer available." }); return;
    }
    const owner = access?.ownerClerkUserId ?? getRequiredClerkUserId(res);
    res.json(GetSoccerGearResponse.parse(await readSoccerGear(owner, db, access?.athleteInviteId)));
  }
  catch (error) { next(error); }
});

router.put("/athlete-gear/soccer", requireProjectEditorAuth, async (req, res, next) => {
  const parsed = SaveSoccerGearBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Choose valid soccer gear and colors." }); return; }
  try {
    const access = res.locals.athleteEditorAccess as AthleteEditorAccess | undefined;
    if (access && (!await validLinkedKit(access) || access.athleteInviteId !== parsed.data.athleteId)) {
      res.status(403).json({ error: "This sign-in can edit only its linked athlete kit." }); return;
    }
    const owner = access?.ownerClerkUserId ?? getRequiredClerkUserId(res);
    const result = await db.transaction(async (tx) => {
      if (access) {
        if (access.projectId === null) return { error: "Athlete kit access is no longer active.", status: 403 };
        const [current] = await tx.select().from(athleteEditorAccessTable).where(and(
          eq(athleteEditorAccessTable.id, access.id),
          eq(athleteEditorAccessTable.status, "active"),
          eq(athleteEditorAccessTable.athleteClerkUserId, getRequiredClerkUserId(res)),
          eq(athleteEditorAccessTable.athleteInviteId, parsed.data.athleteId),
          eq(athleteEditorAccessTable.projectId, access.projectId),
        )).for("update");
        if (!current) return { error: "Athlete kit access is no longer active.", status: 403 };
      }
      const [invite] = await tx.select().from(athleteInvitesTable)
        .where(and(eq(athleteInvitesTable.ownerClerkUserId, owner),
          ...(access ? [eq(athleteInvitesTable.id, access.athleteInviteId)] : []),
        )).for("update");
      if (!invite || invite.sport !== "soccer") return { error: "Create your soccer athlete's HYPE Card first." };
      if (invite.id !== parsed.data.athleteId) return { error: "The selected athlete changed. Refresh before saving this look." };
      const state = await readSoccerGear(owner, tx, access?.athleteInviteId);
      const locked = lockedSoccerSelection(parsed.data.loadout, state.unlockedGear);
      if (locked) return { error: "This gear is still locked. Refresh your progress before equipping it." };
      const showOnHypeCard = access ? state.showOnHypeCard : parsed.data.showOnHypeCard;
      const [previousLook] = await tx.select().from(soccerGearLooksTable).where(eq(soccerGearLooksTable.inviteId, invite.id));
      const loadout = { ...previousLook?.loadout, ...parsed.data.loadout };
      await tx.insert(soccerGearLooksTable).values({
        inviteId: invite.id, loadout, showOnHypeCard,
      }).onConflictDoUpdate({
        target: soccerGearLooksTable.inviteId,
        set: { loadout, showOnHypeCard, updatedAt: new Date() },
      });
      return { state: await readSoccerGear(owner, tx, access?.athleteInviteId) };
    });
    if (result.error) { res.status(result.status ?? 400).json({ error: result.error }); return; }
    res.json(GetSoccerGearResponse.parse(result.state));
  } catch (error) { next(error); }
});

router.post("/athlete-gear/soccer/activity", requireAuth, async (_req, res, next) => {
  try {
    const owner = getRequiredClerkUserId(res);
    await db.insert(soccerGearActivityTable).values({
      ownerClerkUserId: owner, kind: "week", eventKey: soccerWeekKey(new Date()),
    }).onConflictDoNothing();
    res.json(GetSoccerGearResponse.parse(await readSoccerGear(owner)));
  } catch (error) { next(error); }
});

router.post("/athlete-gear/soccer/share-action", requireAuth, async (req, res, next) => {
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
