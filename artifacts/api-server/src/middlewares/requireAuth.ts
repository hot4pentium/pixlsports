import { getAuth } from "@clerk/express";
import type { RequestHandler } from "express";

export type AuthenticatedRequest = Parameters<RequestHandler>[0] & {
  clerkUserId: string;
};

export const requireAuth: RequestHandler = (req, res, next): void => {
  const auth = getAuth(req);
  const userId = auth?.sessionClaims?.userId || auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  res.locals.clerkUserId = userId;
  next();
};

export function getRequiredClerkUserId(res: { locals: Record<string, unknown> }): string {
  const userId = res.locals.clerkUserId;
  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error("Authenticated Clerk user ID is missing");
  }
  return userId;
}