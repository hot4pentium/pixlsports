import { getAuth } from "@clerk/express";
import type { RequestHandler } from "express";
import { and, eq } from "drizzle-orm";
import { db, nativeAccountLinksTable } from "@workspace/db";
import { getAccountLifecycleSnapshot } from "../lib/accountLifecycle";
import { getAthleteEditorAccessForUser } from "../lib/athleteEditorAccess";
import { assertLinkableWebAccount, limitNativeLinkAction } from "../lib/nativeAccountLink";
import { assertNativeNotDeleting } from "../lib/nativeAccountDeletion";
import { NativeLinkError, verifyNativeIdentity, type NativeIdentity } from "../lib/nativeIdentity";

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

function activeAccountGuard(allowAthleteEditor: boolean): RequestHandler {
  return async (req, res, next): Promise<void> => {
  const userId = authenticatedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  res.locals.clerkUserId = userId;
  try {
    const athleteEditorAccess = await getAthleteEditorAccessForUser(userId);
    if (athleteEditorAccess && !athleteEditorAccess.existingAccount) {
      if (!allowAthleteEditor || athleteEditorAccess.status !== "active") {
        res.status(403).json({
          error: "This sign-in is limited to its linked HYPE Card and athlete kit.",
          code: "ATHLETE_EDITOR_SCOPE",
        });
        return;
      }
      res.locals.athleteEditorAccess = athleteEditorAccess;
    }
    const lifecycle = await getAccountLifecycleSnapshot(userId, { touchCancelledActivity: true });
    if (lifecycle.identityBlocked) {
      res.status(423).json({
        error: "Pixl Sports access is blocked for this sign-in.",
        code: "ACCOUNT_IDENTITY_BLOCKED",
      });
      return;
    }
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
}

const requireWebAccount: RequestHandler = activeAccountGuard(false);
export const requireAuth: RequestHandler = requireWebAccount;
export const requireProjectEditorAuth: RequestHandler = activeAccountGuard(true);

type NativeOwnerAuthDependencies = {
  verify: (token: string) => Promise<NativeIdentity>;
  findLinkedOwner: (identity: NativeIdentity) => Promise<string | null>;
  assertOwnerEligible: (ownerId: string) => Promise<void>;
  assertNotDeleting: (identity: NativeIdentity) => Promise<void>;
  rateLimit: (identity: NativeIdentity) => Promise<void>;
};

export function createRequireAuthOrNativeOwner(
  dependencies: NativeOwnerAuthDependencies,
): RequestHandler {
  return async (req, res, next): Promise<void> => {
    if (authenticatedUserId(req)) {
      requireWebAccount(req, res, next);
      return;
    }

    const authorization = req.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer ") || authorization.length > 12000) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const identity = await dependencies.verify(authorization.slice(7));
      await dependencies.rateLimit(identity);
      await dependencies.assertNotDeleting(identity);
      const ownerId = await dependencies.findLinkedOwner(identity);
      if (!ownerId) {
        res.status(409).json({ error: "Connect your PIXL account before starting Live Taps." });
        return;
      }
      await dependencies.assertOwnerEligible(ownerId);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.locals.clerkUserId = ownerId;
      next();
    } catch (error) {
      if (error instanceof NativeLinkError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      next(error);
    }
  };
}

export const requireAuthOrNativeOwner = createRequireAuthOrNativeOwner({
  verify: verifyNativeIdentity,
  findLinkedOwner: async (identity) => {
    const [link] = await db.select({
      ownerClerkUserId: nativeAccountLinksTable.ownerClerkUserId,
    }).from(nativeAccountLinksTable).where(and(
      eq(nativeAccountLinksTable.nativeIssuer, identity.issuer),
      eq(nativeAccountLinksTable.nativeSubject, identity.subject),
    )).limit(1);
    return link?.ownerClerkUserId ?? null;
  },
  assertOwnerEligible: async (ownerId) => assertLinkableWebAccount(ownerId),
  assertNotDeleting: assertNativeNotDeleting,
  rateLimit: (identity) => limitNativeLinkAction(JSON.stringify(identity), "native-request", 300),
});

export function getRequiredClerkUserId(res: { locals: Record<string, unknown> }): string {
  const userId = res.locals.clerkUserId;
  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error("Authenticated Clerk user ID is missing");
  }
  return userId;
}