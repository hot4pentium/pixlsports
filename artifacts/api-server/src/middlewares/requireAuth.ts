import { getAuth } from "@clerk/express";
import type { RequestHandler } from "express";
import { getAccountLifecycleSnapshot } from "../lib/accountLifecycle";

export type AuthenticatedRequest = Parameters<RequestHandler>[0] & {
  clerkUserId: string;
};

function authenticatedUserId(req: Parameters<RequestHandler>[0]) {
  const auth = getAuth(req);
  if (typeof auth?.userId === "string" && auth.userId.length > 0) return auth.userId;
  const claimUserId = auth?.sessionClaims?.userId;
  return typeof claimUserId === "string" && claimUserId.length > 0 ? claimUserId : null;
}

export function getOptionalClerkUserId(req: Parameters<RequestHandler>[0]): string | null {
  return authenticatedUserId(req);
}

export const requireAuthenticatedIdentity: RequestHandler = (req, res, next): void => {
  const userId = authenticatedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  res.locals.clerkUserId = userId;
  next();
};

export const requireAuth: RequestHandler = async (req, res, next): Promise<void> => {
  const userId = authenticatedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  res.locals.clerkUserId = userId;
  try {
    const lifecycle = await getAccountLifecycleSnapshot(userId, { touchCancelledActivity: true });
    if (lifecycle.adminSuspended) {
      res.status(423).json({
        error: "This account is temporarily suspended by an administrator.",
        code: "ACCOUNT_ADMIN_SUSPENDED",
      });
      return;
    }
    if (lifecycle.status !== "active") {
      if (lifecycle.status === "not_provisioned") {
        res.status(423).json({
          error: "No app account is provisioned for this sign-in.",
          code: "ACCOUNT_NOT_PROVISIONED",
        });
        return;
      }
      res.status(423).json({
        error: lifecycle.expired
          ? "Account recovery window has expired."
          : lifecycle.status === "paused" ? "Account is paused." : "Account is cancelled and locked.",
        code: lifecycle.expired ? "ACCOUNT_EXPIRED" : lifecycle.status === "paused" ? "ACCOUNT_PAUSED" : "ACCOUNT_LOCKED",
      });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
};

export function getRequiredClerkUserId(res: { locals: Record<string, unknown> }): string {
  const userId = res.locals.clerkUserId;
  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error("Authenticated Clerk user ID is missing");
  }
  return userId;
}