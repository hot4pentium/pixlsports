import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { GetSportGearForAthleteQueryParams, GetSportGearForAthleteResponse, SaveSportGearBody, SaveSportGearParams } from "@workspace/api-zod";
import { athleteEditorAccessTable, athleteInvitesTable, athleteSportGearLooksTable, cloudProjectsTable, db, type AthleteEditorAccess } from "@workspace/db";
import { getRequiredClerkUserId, requireProjectEditorAuth } from "../middlewares/requireAuth";
import { creditExistingSoccerEventCards, creditExistingSoccerTrackerGames } from "../lib/soccerGear";
import { readSportGear } from "../lib/sportGear";
import { invalidSportGearSelection, publicGearArtFiles, type GearSport } from "../lib/sportGearPolicy";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const sportSchema = SaveSportGearParams.shape.sport;

// This public route serves only our curated artwork, never user-uploaded media.
router.get("/athlete-gear/art/v1/:filename", async (req, res, next) => {
  const filename = String(req.params.filename);
  if (!publicGearArtFiles.has(filename)) { res.status(404).json({ error: "Artwork not found." }); return; }
  try {
    const file = await new ObjectStorageService().searchPublicObject(`showcase-gear/v1/${filename}`);
    if (!file) { res.status(404).json({ error: "Artwork not found." }); return; }
    res.set({ "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
    file.createReadStream().on("error", (error) => {
      req.log.warn({ err: error }, "Could not stream curated gear artwork");
      if (!res.headersSent) res.status(503).end(); else res.destroy();
    }).pipe(res);
  } catch (error) { next(error); }
});

async function validLinkedKit(access: AthleteEditorAccess, sport: GearSport) {
  const [linked] = await db.select({ project: cloudProjectsTable.project }).from(athleteInvitesTable)
    .innerJoin(cloudProjectsTable, and(eq(cloudProjectsTable.id, access.projectId), eq(cloudProjectsTable.ownerClerkUserId, access.ownerClerkUserId)))
    .where(and(eq(athleteInvitesTable.id, access.athleteInviteId), eq(athleteInvitesTable.ownerClerkUserId, access.ownerClerkUserId), eq(athleteInvitesTable.sport, sport))).limit(1);
  return Boolean(linked?.project && typeof linked.project === "object" && (linked.project as Record<string, unknown>).tool === "hype-card");
}

router.get("/athlete-gear/sports", requireProjectEditorAuth, async (req, res, next) => {
  res.set("Cache-Control", "no-store");
  const query = GetSportGearForAthleteQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Choose a supported gear sport." }); return; }
  try {
    const access = res.locals.athleteEditorAccess as AthleteEditorAccess | undefined;
    if (access && !await validLinkedKit(access, query.data.sport)) { res.status(403).json({ error: "The linked athlete gear is unavailable." }); return; }
    const owner = access?.ownerClerkUserId ?? getRequiredClerkUserId(res);
    if (!access) await Promise.all([creditExistingSoccerEventCards(owner), creditExistingSoccerTrackerGames(owner)]);
    res.json(GetSportGearForAthleteResponse.parse(await readSportGear(owner, query.data.sport, db, access?.athleteInviteId, access ? undefined : query.data.athleteName)));
  } catch (error) { next(error); }
});

router.put("/athlete-gear/sports/:sport", requireProjectEditorAuth, async (req, res, next) => {
  res.set("Cache-Control", "no-store");
  const sport = sportSchema.safeParse(req.params.sport);
  const parsed = SaveSportGearBody.safeParse(req.body);
  if (!sport.success || !parsed.success) { res.status(400).json({ error: "Choose valid sport gear and colors." }); return; }
  try {
    const access = res.locals.athleteEditorAccess as AthleteEditorAccess | undefined;
    if (access && !await validLinkedKit(access, sport.data)) {
      res.status(403).json({ error: "This sign-in can edit only its linked athlete gear." }); return;
    }
    const owner = access?.ownerClerkUserId ?? getRequiredClerkUserId(res);
    const result = await db.transaction(async (tx) => {
      let accessInviteId: string | undefined;
      if (access) {
        const [current] = await tx.select().from(athleteEditorAccessTable).where(and(
          eq(athleteEditorAccessTable.id, access.id), eq(athleteEditorAccessTable.status, "active"),
          eq(athleteEditorAccessTable.athleteClerkUserId, getRequiredClerkUserId(res)),
          eq(athleteEditorAccessTable.athleteInviteId, access.athleteInviteId), eq(athleteEditorAccessTable.projectId, access.projectId),
        )).for("update");
        if (!current) return { error: "Athlete gear access is no longer active.", status: 403 };
        const [invite] = await tx.select().from(athleteInvitesTable).where(and(
          eq(athleteInvitesTable.ownerClerkUserId, owner),
          eq(athleteInvitesTable.id, access.athleteInviteId),
        )).for("update");
        if (!invite || invite.sport !== sport.data
          || parsed.data.athleteName && invite.athleteName.trim().toLowerCase() !== parsed.data.athleteName.trim().toLowerCase()) {
          return { error: "This sign-in can edit only its linked athlete gear.", status: 403 };
        }
        accessInviteId = invite.id;
      }
      const state = await readSportGear(owner, sport.data, tx, accessInviteId, access ? undefined : parsed.data.athleteName);
      if (invalidSportGearSelection(sport.data, parsed.data.loadout.equippedGear, state.progress)) {
        return { error: "This equipment is still locked or belongs to another sport.", status: 400 };
      }
      await tx.insert(athleteSportGearLooksTable).values({
        ownerClerkUserId: owner,
        sport: sport.data,
        loadout: parsed.data.loadout,
      }).onConflictDoUpdate({
        target: [athleteSportGearLooksTable.ownerClerkUserId, athleteSportGearLooksTable.sport],
        set: { loadout: parsed.data.loadout, updatedAt: new Date() },
      });
      return { state: await readSportGear(owner, sport.data, tx, accessInviteId, access ? undefined : parsed.data.athleteName) };
    });
    if (result.error) { res.status(result.status ?? 400).json({ error: result.error }); return; }
    res.json(GetSportGearForAthleteResponse.parse(result.state));
  } catch (error) { next(error); }
});

export default router;
