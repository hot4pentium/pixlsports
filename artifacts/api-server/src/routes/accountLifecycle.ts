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
import { isLastAdmin } from "../lib/adminAccess";

const router: IRouter = Router();

router.get("/account/lifecycle", requireAuthenticatedIdentity, async (_req, res): Promise<void> => {
  const userId = getRequiredClerkUserId(res);
  const lifecycle = await getAccountLifecycleSnapshot(userId, { touchCancelledActivity: true });
  res.json(GetAccountLifecycleResponse.parse(lifecycle));
});

router.post("/account/cancel", requireAuthenticatedIdentity, async (_req, res): Promise<void> => {
  const userId = getRequiredClerkUserId(res);
  const before = await getAccountLifecycleSnapshot(userId);
  if (before.adminSuspended) {
    res.status(423).json({ error: "This account is temporarily suspended by an administrator." });
    return;
  }
  if (await isLastAdmin(userId)) {
    res.status(409).json({ error: "The last administrator cannot cancel their account." });
    return;
  }
  const lifecycle = await cancelAccount(userId);
  if (!lifecycle || lifecycle.status === "paused") {
    res.status(409).json({ error: "Only an active account can be cancelled. Resume your pause first." });
    return;
  }
  res.json(CancelAccountResponse.parse(lifecycle));
});

router.post("/account/pause", requireAuthenticatedIdentity, async (_req, res): Promise<void> => {
  const userId = getRequiredClerkUserId(res);
  const before = await getAccountLifecycleSnapshot(userId);
  if (before.adminSuspended) {
    res.status(423).json({ error: "This account is temporarily suspended by an administrator." });
    return;
  }
  if (await isLastAdmin(userId)) {
    res.status(409).json({ error: "The last administrator cannot pause their account." });
    return;
  }
  const lifecycle = await pauseAccount(userId);
  if (!lifecycle) {
    res.status(409).json({ error: "Only active accounts can be paused." });
    return;
  }
  res.json(PauseAccountResponse.parse(lifecycle));
});

router.post("/account/resume", requireAuthenticatedIdentity, async (_req, res): Promise<void> => {
  const userId = getRequiredClerkUserId(res);
  const before = await getAccountLifecycleSnapshot(userId);
  if (before.adminSuspended) {
    res.status(423).json({ error: "This account is temporarily suspended by an administrator." });
    return;
  }
  const lifecycle = await resumeAccount(userId);
  if (!lifecycle) {
    res.status(409).json({ error: "This account cannot be resumed." });
    return;
  }
  res.json(ResumeAccountResponse.parse(lifecycle));
});

router.post("/account/reactivate", requireAuthenticatedIdentity, async (_req, res): Promise<void> => {
  const userId = getRequiredClerkUserId(res);
  const before = await getAccountLifecycleSnapshot(userId);
  if (before.adminSuspended) {
    res.status(423).json({ error: "This account is temporarily suspended by an administrator." });
    return;
  }
  const lifecycle = await reactivateAccount(userId);
  if (!lifecycle) {
    res.status(410).json({ error: "The recovery window has expired." });
    return;
  }
  res.json(ReactivateAccountResponse.parse(lifecycle));
});

export default router;