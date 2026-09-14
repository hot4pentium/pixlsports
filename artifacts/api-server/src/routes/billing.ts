import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import {
  reactivateAccountFromEntitlement,
  type PaidEntitlement,
} from "../lib/accountLifecycle";

type RawBodyRequest = Request & { rawBody?: Buffer };

type PaidEntitlementEvent = {
  type: "paid_entitlement";
  id: string;
  ownerClerkUserId: string;
  paid: true;
  expiresAt: Date;
};

function hasValidSignature(req: RawBodyRequest) {
  const secret = process.env.BILLING_WEBHOOK_SECRET;
  const supplied = req.get("x-billing-signature");
  if (!secret || !supplied || !req.rawBody) return false;

  const expected = createHmac("sha256", secret).update(req.rawBody).digest("hex");
  const provided = supplied.startsWith("sha256=") ? supplied.slice("sha256=".length) : supplied;
  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(provided, "hex");
  return providedBuffer.length === expectedBuffer.length
    && timingSafeEqual(providedBuffer, expectedBuffer);
}

function parsePaidEntitlementEvent(body: unknown): PaidEntitlementEvent | null {
  if (!body || typeof body !== "object") return null;
  const event = body as Record<string, unknown>;
  if (
    event.type !== "paid_entitlement"
    || event.paid !== true
    || typeof event.id !== "string"
    || event.id.length === 0
    || event.id.length > 200
    || typeof event.ownerClerkUserId !== "string"
    || event.ownerClerkUserId.length === 0
    || event.ownerClerkUserId.length > 200
    || typeof event.expiresAt !== "string"
  ) {
    return null;
  }

  const expiresAt = new Date(event.expiresAt);
  if (!Number.isFinite(expiresAt.getTime())) return null;
  return {
    type: "paid_entitlement",
    id: event.id,
    ownerClerkUserId: event.ownerClerkUserId,
    paid: true,
    expiresAt,
  };
}

const router: IRouter = Router();

router.post("/billing/webhook", async (req, res): Promise<void> => {
  const rawRequest = req as RawBodyRequest;
  if (!hasValidSignature(rawRequest)) {
    res.status(401).json({ error: "Invalid billing webhook signature." });
    return;
  }

  const event = parsePaidEntitlementEvent(req.body);
  if (!event) {
    res.status(400).json({ error: "Unsupported paid entitlement event." });
    return;
  }

  const entitlement: PaidEntitlement = {
    providerEventId: event.id,
    ownerClerkUserId: event.ownerClerkUserId,
    expiresAt: event.expiresAt,
  };
  const result = await reactivateAccountFromEntitlement(entitlement);
  res.json({
    ok: true,
    replayed: result.replayed,
    restored: result.restored,
    status: result.lifecycle?.status ?? null,
  });
});

export default router;