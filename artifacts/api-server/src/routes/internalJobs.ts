import { Router, type IRouter, type Request, type Response } from "express";
import { lt } from "drizzle-orm";
import { db, internalJobRequestsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  GAME_ON_ALERTS_TRIGGER_SECRET_MIN_LENGTH,
  isValidGameOnAlertCronRequest,
  isValidGameOnAlertSignature,
} from "../lib/gameOnAlertSchedulerAuth";
import { runPlannerNotificationJob } from "../jobs/plannerNotifications";

const REPLAY_RETENTION_MS = 24 * 60 * 60 * 1000;

type InternalJobDependencies = {
  getSecret?: () => string | undefined;
  getCronToken?: () => string | undefined;
  claimNonce?: (nonce: string, createdAt: Date) => Promise<boolean>;
  runGameOnAlerts?: () => Promise<void>;
  now?: () => number;
};

async function claimGameOnAlertNonce(nonce: string, createdAt: Date) {
  await db.delete(internalJobRequestsTable).where(lt(
    internalJobRequestsTable.createdAt,
    new Date(createdAt.getTime() - REPLAY_RETENTION_MS),
  ));
  const [claimed] = await db.insert(internalJobRequestsTable).values({
    nonce,
    jobName: "game-on-reminders",
    createdAt,
  }).onConflictDoNothing().returning({ nonce: internalJobRequestsTable.nonce });
  return Boolean(claimed);
}

export function createInternalJobsRouter(dependencies: InternalJobDependencies = {}) {
  const router: IRouter = Router();
  const getSecret = dependencies.getSecret ?? (() => process.env["GAME_ON_ALERTS_TRIGGER_SECRET"]);
  const getCronToken = dependencies.getCronToken ?? (() => process.env["GAME_ON_ALERTS_CRON_TOKEN"]);
  const claimNonce = dependencies.claimNonce ?? claimGameOnAlertNonce;
  const runGameOnAlerts = dependencies.runGameOnAlerts ?? runPlannerNotificationJob;
  const now = dependencies.now ?? Date.now;

  async function runAuthorizedJob(req: Request, res: Response, nonce: string, nowMs: number) {
    const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody;
    const contentLength = Number(req.get("content-length") ?? "0");
    const hasBody = (rawBody?.length ?? 0) > 0
      || (Number.isFinite(contentLength) && contentLength > 0)
      || Boolean(req.get("transfer-encoding"));
    if (hasBody || Object.keys(req.query).length > 0) {
      res.status(400).json({ error: "Scheduled job requests must not include a body or query." });
      return;
    }

    let phase: "claim" | "run" = "claim";
    try {
      const claimed = await claimNonce(nonce, new Date(nowMs));
      if (!claimed) {
        res.status(409).json({ error: "Scheduled job request was already used." });
        return;
      }
      phase = "run";
      await runGameOnAlerts();
      res.status(200).json({ success: true });
    } catch {
      // Push-provider and database errors can contain endpoints or private
      // event data. Log only the failing phase; HTTP status reports failure.
      logger.error({ phase }, "Game On scheduled reminder run failed");
      res.status(500).json({ error: "Game On reminders could not be processed." });
    }
  }

  router.post("/internal/jobs/game-on-alerts", async (req, res): Promise<void> => {
    const secret = getSecret();
    if (!secret || secret.length < GAME_ON_ALERTS_TRIGGER_SECRET_MIN_LENGTH) {
      res.status(503).json({ error: "Scheduled reminders are not configured." });
      return;
    }
    const timestamp = req.get("x-game-on-alerts-timestamp") ?? "";
    const nonce = req.get("x-game-on-alerts-nonce") ?? "";
    const signature = req.get("x-game-on-alerts-signature") ?? "";
    const nowMs = now();
    if (!isValidGameOnAlertSignature({ timestamp, nonce, signature }, secret, nowMs)) {
      res.status(401).json({ error: "Invalid scheduled job request." });
      return;
    }
    await runAuthorizedJob(req, res, nonce, nowMs);
  });

  router.post("/internal/jobs/game-on-alerts/cron", async (req, res): Promise<void> => {
    const secret = getCronToken();
    if (!secret || secret.length < GAME_ON_ALERTS_TRIGGER_SECRET_MIN_LENGTH) {
      res.status(503).json({ error: "Scheduled reminders are not configured." });
      return;
    }
    const timestamp = req.get("x-game-on-alerts-timestamp") ?? "";
    const nonce = req.get("x-game-on-alerts-nonce") ?? "";
    const token = req.get("x-game-on-alerts-token") ?? "";
    const nowMs = now();
    if (!isValidGameOnAlertCronRequest({ timestamp, nonce, token }, secret, nowMs)) {
      res.status(401).json({ error: "Invalid scheduled job request." });
      return;
    }
    await runAuthorizedJob(req, res, nonce, nowMs);
  });

  return router;
}

export default createInternalJobsRouter();