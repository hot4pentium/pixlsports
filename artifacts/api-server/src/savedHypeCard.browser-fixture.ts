/**
 * Local integration server, never mounted by the application.
 * Only Clerk session verification is replaced with isolated test identities.
 * requireAuth, ownership checks, Zod contracts, PostgreSQL, image sanitization,
 * upload claims and App Storage all use their production implementations.
 */
import { randomUUID } from "node:crypto";
import express from "express";
import { inArray } from "drizzle-orm";
import sharp from "sharp";
import { accountAccessTable, athleteInvitesTable, athleteInvitePhotoUploadClaimsTable, db, pool } from "@workspace/db";
import athleteInvitesRouter from "./routes/athleteInvites";
import athleteInviteFeaturesRouter from "./routes/athleteInviteFeatures";
import { ObjectNotFoundError, ObjectStorageService } from "./lib/objectStorage";
import { logger } from "./lib/logger";

if (process.env.SAVED_HYPE_BROWSER_FIXTURE !== "1" || process.env.NODE_ENV === "production") {
  throw new Error("Saved HYPE Card fixture requires explicit local test opt-in.");
}

const owner = `saved-hype-first-${randomUUID()}`;
const other = `saved-hype-second-${randomUUID()}`;
const users = [owner, other];
const storage = new ObjectStorageService();
const uploadPaths = new Set<string>();

async function main() {
  await db.insert(accountAccessTable).values(users.map(ownerClerkUserId => ({
    ownerClerkUserId, role: "fan", accessMode: "full",
  })));
  const app = express();
  app.use(express.json());
  app.get("/__fixture/health", (_req, res) => res.json({ owner, other }));
  app.get("/__fixture/portrait/:variant", async (req, res) => {
    const color = req.params.variant === "replacement" ? "#22CC88" : "#EEAA33";
    const subject = await sharp({ create: { width: 60, height: 100, channels: 4, background: color } }).png().toBuffer();
    const image = await sharp({ create: {
      width: 120, height: 160, channels: 4,
      background: req.params.variant === "cutout" ? "#00000000" : "#183A60",
    } }).composite([{ input: subject, left: 30, top: 30 }]).png().toBuffer();
    res.type("png").send(image);
  });
  app.use("/api", (req, res, next) => {
    const viewer = req.header("x-test-user");
    const auth = () => ({
      userId: viewer && users.includes(viewer) ? viewer : undefined,
      tokenType: "session_token",
    });
    (auth as typeof auth & { [key: symbol]: boolean })[Symbol.for("@clerk/express.auth")] = true;
    (req as typeof req & { auth: typeof auth }).auth = auth;
    req.log = logger;
    // Remember real upload paths even if the test fails before confirmation.
    const json = res.json.bind(res);
    res.json = (body) => {
      if (req.path.endsWith("/photo/upload-url") && typeof body?.objectPath === "string") {
        uploadPaths.add(body.objectPath);
      }
      return json(body);
    };
    next();
  });
  app.use("/api", athleteInvitesRouter);
  app.use("/api", athleteInviteFeaturesRouter);
  // Unrelated dashboard widgets are outside this integration's scope.
  app.get("/api/game-on-cards/owned", (_req, res) => res.json([]));
  app.get("/api/projects", (_req, res) => res.json([]));
  app.get("/api/hype-card-shares/reply-inbox", (_req, res) =>
    res.json({ groups: [], unreadCount: 0, totalCount: 0 }));
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  const server = app.listen(Number(process.env.PORT), "127.0.0.1");
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await new Promise<void>((done) => server.close(() => done()));
    const invites = await db.select().from(athleteInvitesTable)
      .where(inArray(athleteInvitesTable.ownerClerkUserId, users));
    const claims = await db.select().from(athleteInvitePhotoUploadClaimsTable)
      .where(inArray(athleteInvitePhotoUploadClaimsTable.ownerClerkUserId, users));
    for (const claim of claims) uploadPaths.add(claim.objectPath);
    for (const invite of invites) {
      if (invite.photoObjectPath) uploadPaths.add(invite.photoObjectPath);
      if (invite.cutoutObjectPath) uploadPaths.add(invite.cutoutObjectPath);
    }
    for (const path of uploadPaths) {
      try { await storage.deleteObjectEntity(path); } catch (error) {
        if (!(error instanceof ObjectNotFoundError)) throw error;
      }
    }
    await db.delete(athleteInvitesTable).where(inArray(athleteInvitesTable.ownerClerkUserId, users));
    await db.delete(accountAccessTable).where(inArray(accountAccessTable.ownerClerkUserId, users));
    await pool.end();
  };
  process.once("SIGTERM", () => void shutdown().catch(error => {
    logger.error({ err: error }, "Saved HYPE fixture cleanup failed");
    process.exit(1);
  }));
  process.once("SIGINT", () => void shutdown().catch(error => {
    logger.error({ err: error }, "Saved HYPE fixture cleanup failed");
    process.exit(1);
  }));
}

main().catch(error => {
  logger.error({ err: error }, "Saved HYPE fixture startup failed");
  process.exit(1);
});