import { Router, type IRouter } from "express";
import {
  CancelAccountResponse,
  GetAccountLifecycleResponse,
  PauseAccountResponse,
  ResumeAccountResponse,
  ReactivateAccountResponse,
} from "@workspace/api-zod";
import {
  cancelAccount,
  getAccountLifecycleSnapshot,
  pauseAccount,
  resumeAccount,
  reactivateAccount,
} from "../lib/accountLifecycle";
import {
  getRequiredClerkUserId,
  requireAuthenticatedIdentity,
} from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/account/lifecycle", requireAuthenticatedIdentity, async (_req, res): Promise<void> => {
  const userId = getRequiredClerkUserId(res);
  const lifecycle = await getAccountLifecycleSnapshot(userId, { touchCancelledActivity: true });
  res.json(GetAccountLifecycleResponse.parse(lifecycle));
});

router.post("/account/cancel", requireAuthenticatedIdentity, async (_req, res): Promise<void> => {
  const lifecycle = await cancelAccount(getRequiredClerkUserId(res));
  if (!lifecycle || lifecycle.status === "paused") {
    res.status(409).json({ error: "Only an active account can be cancelled. Resume your pause first." });
    return;
  }
  res.json(CancelAccountResponse.parse(lifecycle));
});

router.post("/account/pause", requireAuthenticatedIdentity, async (_req, res): Promise<void> => {
  const lifecycle = await pauseAccount(getRequiredClerkUserId(res));
  if (!lifecycle) {
    res.status(409).json({ error: "Only active accounts can be paused." });
    return;
  }
  res.json(PauseAccountResponse.parse(lifecycle));
});

router.post("/account/resume", requireAuthenticatedIdentity, async (_req, res): Promise<void> => {
  const lifecycle = await resumeAccount(getRequiredClerkUserId(res));
  if (!lifecycle) {
    res.status(409).json({ error: "This account cannot be resumed." });
    return;
  }
  res.json(ResumeAccountResponse.parse(lifecycle));
});

router.post("/account/reactivate", requireAuthenticatedIdentity, async (_req, res): Promise<void> => {
  const lifecycle = await reactivateAccount(getRequiredClerkUserId(res));
  if (!lifecycle) {
    res.status(410).json({ error: "The recovery window has expired." });
    return;
  }
  res.json(ReactivateAccountResponse.parse(lifecycle));
});

export default router;