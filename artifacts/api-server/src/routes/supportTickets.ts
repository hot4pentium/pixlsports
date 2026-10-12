import { createHash, randomBytes, randomInt } from "node:crypto";
import { and, count, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  CreateAdminSupportTicketReplyBody,
  CreateAdminSupportTicketReplyParams,
  CreateAdminSupportTicketReplyResponse,
  CreateSupportTicketBody,
  CreateSupportTicketMessageBody,
  CreateSupportTicketMessageParams,
  CreateSupportTicketMessageResponse,
  CreateSupportTicketResponse,
  RequestSupportTicketRecoveryBody,
  RequestSupportTicketRecoveryResponse,
  VerifySupportTicketRecoveryBody,
  VerifySupportTicketRecoveryResponse,
  GetAdminSupportTicketParams,
  GetAdminSupportTicketResponse,
  GetSupportTicketParams,
  GetSupportTicketResponse,
  ListAdminSupportTicketsQueryParams,
  ListAdminSupportTicketsResponse,
  ListSupportTicketsResponse,
  UpdateAdminSupportTicketBody,
  UpdateAdminSupportTicketParams,
  UpdateAdminSupportTicketResponse,
} from "@workspace/api-zod";
import {
  db,
  supportTicketEmailReplyTokensTable,
  supportTicketMessagesTable,
  supportTicketsTable,
  type SupportTicket,
  type SupportTicketMessage,
} from "@workspace/db";
import { requireAdmin } from "../lib/adminAccess";
import {
  buildSupportTicketReplyAddress,
  hashSupportTicketReplyToken,
  normalizeSupportEmailMessageId,
  normalizeSupportReplyDomain,
} from "../lib/supportTicketEmailReply";
import {
  generateSupportTicketReference,
  insertSupportTicketWithUniqueReference,
  SupportTicketReferenceUnavailableError,
} from "../lib/supportTicketReference";
import { getOptionalClerkUserId, getRequiredClerkUserId, requireAuthenticatedIdentity } from "../middlewares/requireAuth";

type TicketEmail = { reference: string; replyEmail: string; body: string; replyTo?: string };
type TicketEmailSendResult = { messageId?: string };
type TicketRecoveryEmail = { reference: string; replyEmail: string; code: string };
type SupportTicketDependencies = {
  sendReplyEmail?: (message: TicketEmail) => Promise<TicketEmailSendResult | void>;
  sendRecoveryEmail?: (message: TicketRecoveryEmail) => Promise<void>;
  createReference?: () => string;
  supportReplyDomain?: string | null;
  requireAdmin?: RequestHandler;
  now?: () => number;
  maxRequests?: number;
  windowMs?: number;
};

type RateLimitEntry = { count: number; resetAt: number };

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function publicMessage(message: SupportTicketMessage) {
  return {
    id: message.id,
    senderRole: message.senderRole,
    body: message.body,
    deliveryStatus: message.deliveryStatus,
    createdAt: message.createdAt,
  };
}

function publicTicket(ticket: SupportTicket, messages: SupportTicketMessage[] = []) {
  return {
    id: ticket.id,
    reference: ticket.reference,
    replyEmail: ticket.replyEmail,
    issueId: ticket.issueId,
    description: ticket.description,
    deviceType: ticket.deviceType,
    connectionType: ticket.connectionType,
    diagnostics: ticket.diagnostics,
    status: ticket.status,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    messages: messages.filter((message) => message.ticketId === ticket.id).map(publicMessage),
  };
}

async function ticketWithMessages(ticket: SupportTicket) {
  const messages = await db.select().from(supportTicketMessagesTable)
    .where(eq(supportTicketMessagesTable.ticketId, ticket.id))
    .orderBy(supportTicketMessagesTable.createdAt);
  return publicTicket(ticket, messages);
}

async function findTicket(ticketId: string) {
  const [ticket] = await db.select().from(supportTicketsTable)
    .where(eq(supportTicketsTable.id, ticketId))
    .limit(1);
  return ticket;
}

function canAccessTicket(ticket: SupportTicket, clerkUserId: string | null, token: string | undefined) {
  if (ticket.ownerClerkUserId && clerkUserId === ticket.ownerClerkUserId) return true;
  if (!token) return false;
  return hashToken(token) === ticket.accessTokenHash;
}

async function sendReplyWithResend(message: TicketEmail): Promise<TicketEmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Pixl Sports Support <support@pixlsports.com>",
      to: [message.replyEmail],
      reply_to: message.replyTo ?? "support@pixlsports.com",
      subject: `Update on Pixl Sports support ticket ${message.reference}`,
      text: [
        `Pixl Sports support replied to ticket ${message.reference}.`,
        "",
        message.body,
        "",
        message.replyTo
          ? "You can reply directly to this email. Your reply will be added to the same ticket."
          : "Sign in and open Help to review the complete ticket conversation. Email-app replies are not being added yet.",
      ].join("\n"),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Resend rejected support reply with status ${response.status}`);
  const sendResult = await response.json().catch(() => undefined) as { id?: unknown; message_id?: unknown } | undefined;
  if (typeof sendResult?.message_id === "string") {
    return { messageId: normalizeSupportEmailMessageId(sendResult.message_id) };
  }
  if (typeof sendResult?.id !== "string") return {};

  // The send response has historically returned only the provider ID. Retrieve the
  // sent record to capture its RFC Message-ID for reliable replies to this thread.
  try {
    const sentEmailResponse = await fetch(
      `https://api.resend.com/emails/${encodeURIComponent(sendResult.id)}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!sentEmailResponse.ok) return {};
    const sentEmail = await sentEmailResponse.json() as { message_id?: unknown };
    return { messageId: normalizeSupportEmailMessageId(sentEmail.message_id) };
  } catch {
    // Delivery already succeeded. A missing thread ID must not turn it into a
    // reported delivery failure; the legacy lookup can still find it in Resend.
    return {};
  }
}

async function sendRecoveryWithResend(message: TicketRecoveryEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Pixl Sports Support <support@pixlsports.com>",
      to: [message.replyEmail],
      reply_to: "support@pixlsports.com",
      subject: `Your Pixl Sports support ticket ${message.reference}`,
      text: [
        `Use this code to reopen support ticket ${message.reference}:`,
        "",
        message.code,
        "",
        "This code expires in 10 minutes and can only be used once. If you did not request it, you can ignore this email.",
      ].join("\n"),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Resend rejected support recovery email with status ${response.status}`);
}

export function createSupportTicketsRouter(dependencies: SupportTicketDependencies = {}) {
  const router: IRouter = Router();
  const sendReplyEmail = dependencies.sendReplyEmail ?? sendReplyWithResend;
  const sendRecoveryEmail = dependencies.sendRecoveryEmail ?? sendRecoveryWithResend;
  const createReference = dependencies.createReference ?? generateSupportTicketReference;
  const adminGuard = dependencies.requireAdmin ?? requireAdmin;
  const now = dependencies.now ?? Date.now;
  const maxRequests = dependencies.maxRequests ?? 5;
  const windowMs = dependencies.windowMs ?? 10 * 60 * 1000;
  const supportReplyDomain = normalizeSupportReplyDomain(
    dependencies.supportReplyDomain !== undefined
      ? dependencies.supportReplyDomain
      : process.env.RESEND_WEBHOOK_SECRET
        ? process.env.RESEND_INBOUND_DOMAIN
        : undefined,
  );
  const attempts = new Map<string, RateLimitEntry>();
  const recoveryAttempts = new Map<string, RateLimitEntry>();

  router.use("/support/tickets/recovery", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  router.post("/support/tickets", async (req, res): Promise<void> => {
    const parsed = CreateSupportTicketBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    if (parsed.data.website?.trim()) {
      res.status(400).json({ error: "Ticket could not be created." });
      return;
    }
    const timestamp = now();
    const ip = req.ip || "unknown";
    const current = attempts.get(ip);
    if (current && current.resetAt > timestamp && current.count >= maxRequests) {
      res.set("Retry-After", String(Math.max(1, Math.ceil((current.resetAt - timestamp) / 1000))));
      res.status(429).json({ error: "Please wait before creating another support ticket." });
      return;
    }
    if (!current || current.resetAt <= timestamp) attempts.set(ip, { count: 1, resetAt: timestamp + windowMs });
    else current.count += 1;

    const accessToken = randomBytes(32).toString("base64url");
    let ticket: SupportTicket;
    try {
      ticket = await insertSupportTicketWithUniqueReference(
        async (reference) => {
          const [created] = await db.insert(supportTicketsTable).values({
            reference,
            ownerClerkUserId: getOptionalClerkUserId(req),
            accessTokenHash: hashToken(accessToken),
            replyEmail: parsed.data.replyEmail.trim().toLowerCase(),
            issueId: parsed.data.issueId,
            description: parsed.data.description.trim(),
            deviceType: parsed.data.deviceType,
            connectionType: parsed.data.connectionType,
            diagnostics: parsed.data.diagnostics ?? null,
          }).onConflictDoNothing({ target: supportTicketsTable.reference }).returning();
          return created ?? null;
        },
        createReference,
      );
    } catch (error) {
      if (!(error instanceof SupportTicketReferenceUnavailableError)) throw error;
      req.log.error({ attempts: error.attempts }, "Unable to assign a unique support ticket reference");
      res.status(503).json({ error: "Your ticket could not be created right now. Please try again." });
      return;
    }
    res.status(201).json(CreateSupportTicketResponse.parse({
      ticket: publicTicket(ticket),
      accessToken,
    }));
  });

  router.post("/support/tickets/recovery/request", async (req, res): Promise<void> => {
    const parsed = RequestSupportTicketRecoveryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter the ticket reference and the reply email used on that ticket." });
      return;
    }
    const timestamp = now();
    const ip = req.ip || "unknown";
    const current = recoveryAttempts.get(ip);
    if (current && current.resetAt > timestamp && current.count >= 5) {
      res.set("Retry-After", String(Math.max(1, Math.ceil((current.resetAt - timestamp) / 1000))));
      res.status(429).json({ error: "Please wait before requesting another recovery code." });
      return;
    }
    if (!current || current.resetAt <= timestamp) recoveryAttempts.set(ip, { count: 1, resetAt: timestamp + 15 * 60 * 1000 });
    else current.count += 1;

    const reference = parsed.data.reference.trim().toUpperCase();
    const email = parsed.data.email.trim().toLowerCase();
    const [ticket] = await db.select().from(supportTicketsTable)
      .where(and(
        eq(supportTicketsTable.reference, reference),
        eq(supportTicketsTable.replyEmail, email),
        isNull(supportTicketsTable.ownerClerkUserId),
      ))
      .limit(1);

    const accepted = { message: "If a guest ticket matches those details, recovery instructions were sent or are on their way to its original reply email." };
    if (!ticket) {
      res.status(202).json(RequestSupportTicketRecoveryResponse.parse(accepted));
      return;
    }

    const recoveryCode = String(randomInt(10_000_000, 100_000_000));
    const codeHash = hashToken(recoveryCode);
    const sentAt = new Date(timestamp);
    const [claim] = await db.update(supportTicketsTable)
      .set({
        recoveryCodeHash: codeHash,
        recoveryCodeExpiresAt: new Date(timestamp + 10 * 60 * 1000),
        recoveryRequestedAt: sentAt,
        recoveryAttempts: 0,
      })
      .where(and(
        eq(supportTicketsTable.id, ticket.id),
        isNull(supportTicketsTable.ownerClerkUserId),
        or(isNull(supportTicketsTable.recoveryRequestedAt), lt(supportTicketsTable.recoveryRequestedAt, new Date(timestamp - 60 * 1000))),
      ))
      .returning({ id: supportTicketsTable.id });
    if (!claim) {
      res.status(202).json(RequestSupportTicketRecoveryResponse.parse(accepted));
      return;
    }

    void sendRecoveryEmail({ reference: ticket.reference, replyEmail: ticket.replyEmail, code: recoveryCode })
      .catch(async () => {
        try {
          await db.update(supportTicketsTable)
            .set({ recoveryCodeHash: null, recoveryCodeExpiresAt: null, recoveryRequestedAt: null, recoveryAttempts: 0 })
            .where(and(eq(supportTicketsTable.id, ticket.id), eq(supportTicketsTable.recoveryCodeHash, codeHash)));
        } catch {
          // Do not log the email payload, which includes the one-time recovery code.
        }
        req.log.error({ ticketId: ticket.id }, "Support ticket recovery email delivery failed");
      });
    res.status(202).json(RequestSupportTicketRecoveryResponse.parse(accepted));
  });

  router.post("/support/tickets/recovery/verify", async (req, res): Promise<void> => {
    const parsed = VerifySupportTicketRecoveryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter the ticket reference, reply email, and eight-digit code." });
      return;
    }
    const reference = parsed.data.reference.trim().toUpperCase();
    const email = parsed.data.email.trim().toLowerCase();
    const codeHash = hashToken(parsed.data.code);
    const timestamp = new Date(now());
    const [ticket] = await db.select().from(supportTicketsTable)
      .where(and(
        eq(supportTicketsTable.reference, reference),
        eq(supportTicketsTable.replyEmail, email),
        isNull(supportTicketsTable.ownerClerkUserId),
      ))
      .limit(1);
    if (!ticket) {
      res.status(400).json({ error: "The code could not be verified. Check the details or request a new code." });
      return;
    }

    const accessToken = randomBytes(32).toString("base64url");
    const updated = await db.transaction(async (tx) => {
      const [verified] = await tx.update(supportTicketsTable)
        .set({
          accessTokenHash: hashToken(accessToken),
          recoveryCodeHash: null,
          recoveryCodeExpiresAt: null,
          recoveryRequestedAt: null,
          recoveryAttempts: 0,
        })
        .where(and(
          eq(supportTicketsTable.id, ticket.id),
          eq(supportTicketsTable.recoveryCodeHash, codeHash),
          gt(supportTicketsTable.recoveryCodeExpiresAt, timestamp),
          lt(supportTicketsTable.recoveryAttempts, 5),
          isNull(supportTicketsTable.ownerClerkUserId),
        ))
        .returning();
      if (verified) return verified;

      await tx.update(supportTicketsTable)
        .set({ recoveryAttempts: sql`${supportTicketsTable.recoveryAttempts} + 1` })
        .where(and(
          eq(supportTicketsTable.id, ticket.id),
          isNotNull(supportTicketsTable.recoveryCodeHash),
          gt(supportTicketsTable.recoveryCodeExpiresAt, timestamp),
          lt(supportTicketsTable.recoveryAttempts, 5),
          isNull(supportTicketsTable.ownerClerkUserId),
        ));
      return undefined;
    });
    if (!updated) {
      res.status(400).json({ error: "The code could not be verified. Check the details or request a new code." });
      return;
    }

    res.json(VerifySupportTicketRecoveryResponse.parse({ ticket: await ticketWithMessages(updated), accessToken }));
  });

  router.get("/support/tickets", requireAuthenticatedIdentity, async (_req, res): Promise<void> => {
    const tickets = await db.select().from(supportTicketsTable)
      .where(eq(supportTicketsTable.ownerClerkUserId, getRequiredClerkUserId(res)))
      .orderBy(desc(supportTicketsTable.updatedAt));
    if (!tickets.length) {
      res.json(ListSupportTicketsResponse.parse([]));
      return;
    }
    const messages = await db.select().from(supportTicketMessagesTable)
      .where(inArray(supportTicketMessagesTable.ticketId, tickets.map((ticket) => ticket.id)))
      .orderBy(supportTicketMessagesTable.createdAt);
    res.json(ListSupportTicketsResponse.parse(tickets.map((ticket) => publicTicket(ticket, messages))));
  });

  router.get("/support/tickets/:ticketId", async (req, res): Promise<void> => {
    const params = GetSupportTicketParams.safeParse(req.params);
    const token = typeof req.headers["x-support-ticket-token"] === "string"
      ? req.headers["x-support-ticket-token"]
      : undefined;
    if (!params.success || (token !== undefined && (token.length < 32 || token.length > 200))) {
      res.status(400).json({ error: "Invalid ticket request." });
      return;
    }
    const ticket = await findTicket(params.data.ticketId);
    if (!ticket || !canAccessTicket(ticket, getOptionalClerkUserId(req), token)) {
      res.status(404).json({ error: "Support ticket not found." });
      return;
    }
    res.json(GetSupportTicketResponse.parse(await ticketWithMessages(ticket)));
  });

  router.post("/support/tickets/:ticketId/messages", async (req, res): Promise<void> => {
    const params = CreateSupportTicketMessageParams.safeParse(req.params);
    const parsed = CreateSupportTicketMessageBody.safeParse(req.body);
    const token = typeof req.headers["x-support-ticket-token"] === "string" ? req.headers["x-support-ticket-token"] : undefined;
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "Enter a message of 1 to 5000 characters." });
      return;
    }
    const ticket = await findTicket(params.data.ticketId);
    if (!ticket || !canAccessTicket(ticket, getOptionalClerkUserId(req), token)) {
      res.status(404).json({ error: "Support ticket not found." });
      return;
    }
    const [message] = await db.transaction(async (tx) => {
      const created = await tx.insert(supportTicketMessagesTable).values({
        ticketId: ticket.id,
        senderRole: "member",
        senderClerkUserId: getOptionalClerkUserId(req),
        body: parsed.data.body.trim(),
      }).returning();
      await tx.update(supportTicketsTable).set({ status: "active", updatedAt: new Date() })
        .where(eq(supportTicketsTable.id, ticket.id));
      return created;
    });
    res.status(201).json(CreateSupportTicketMessageResponse.parse(publicMessage(message)));
  });

  router.get("/admin/support/tickets", adminGuard, async (req, res): Promise<void> => {
    const parsed = ListAdminSupportTicketsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const statuses = parsed.data.status?.length ? parsed.data.status : ["unread", "active", "resolved"];
    const where = inArray(supportTicketsTable.status, statuses);
    const [tickets, [{ value: totalCount }], groupedCounts] = await Promise.all([
      db.select().from(supportTicketsTable).where(where).orderBy(desc(supportTicketsTable.updatedAt))
        .limit(parsed.data.limit ?? 50).offset(parsed.data.offset ?? 0),
      db.select({ value: count() }).from(supportTicketsTable).where(where),
      db.select({ status: supportTicketsTable.status, value: count() }).from(supportTicketsTable).groupBy(supportTicketsTable.status),
    ]);
    const messages = tickets.length
      ? await db.select().from(supportTicketMessagesTable)
        .where(inArray(supportTicketMessagesTable.ticketId, tickets.map((ticket) => ticket.id)))
        .orderBy(supportTicketMessagesTable.createdAt)
      : [];
    const counts = { unread: 0, active: 0, resolved: 0 };
    for (const row of groupedCounts) {
      if (row.status in counts) counts[row.status as keyof typeof counts] = Number(row.value);
    }
    res.json(ListAdminSupportTicketsResponse.parse({
      items: tickets.map((ticket) => publicTicket(ticket, messages)),
      counts,
      totalCount: Number(totalCount),
      limit: parsed.data.limit ?? 50,
      offset: parsed.data.offset ?? 0,
    }));
  });

  router.get("/admin/support/tickets/:ticketId", adminGuard, async (req, res): Promise<void> => {
    const params = GetAdminSupportTicketParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const ticket = await findTicket(params.data.ticketId);
    if (!ticket) {
      res.status(404).json({ error: "Support ticket not found." });
      return;
    }
    res.json(GetAdminSupportTicketResponse.parse(await ticketWithMessages(ticket)));
  });

  router.patch("/admin/support/tickets/:ticketId", adminGuard, async (req, res): Promise<void> => {
    const params = UpdateAdminSupportTicketParams.safeParse(req.params);
    const parsed = UpdateAdminSupportTicketBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "Choose unread, active, or resolved." });
      return;
    }
    const [ticket] = await db.update(supportTicketsTable)
      .set({ status: parsed.data.status, updatedAt: new Date() })
      .where(eq(supportTicketsTable.id, params.data.ticketId))
      .returning();
    if (!ticket) {
      res.status(404).json({ error: "Support ticket not found." });
      return;
    }
    res.json(UpdateAdminSupportTicketResponse.parse(await ticketWithMessages(ticket)));
  });

  router.post("/admin/support/tickets/:ticketId/replies", adminGuard, async (req, res): Promise<void> => {
    const params = CreateAdminSupportTicketReplyParams.safeParse(req.params);
    const parsed = CreateAdminSupportTicketReplyBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "Enter a reply of 1 to 5000 characters." });
      return;
    }
    const ticket = await findTicket(params.data.ticketId);
    if (!ticket) {
      res.status(404).json({ error: "Support ticket not found." });
      return;
    }
    let deliveryStatus: "sent" | "failed" = "sent";
    let emailMessageId: string | undefined;
    try {
      let replyTo: string | undefined;
      if (supportReplyDomain) {
        const replyToken = randomBytes(28).toString("hex");
        replyTo = buildSupportTicketReplyAddress(replyToken, supportReplyDomain);
        await db.insert(supportTicketEmailReplyTokensTable).values({
          ticketId: ticket.id,
          tokenHash: hashSupportTicketReplyToken(replyToken),
        });
      }
      const sendResult = await sendReplyEmail({
        reference: ticket.reference,
        replyEmail: ticket.replyEmail,
        body: parsed.data.body.trim(),
        replyTo,
      });
      emailMessageId = normalizeSupportEmailMessageId(sendResult?.messageId);
    } catch (error) {
      deliveryStatus = "failed";
      req.log.error({ err: error, ticketId: ticket.id }, "Support reply email delivery failed");
    }
    const [message] = await db.transaction(async (tx) => {
      const created = await tx.insert(supportTicketMessagesTable).values({
        ticketId: ticket.id,
        senderRole: "admin",
        senderClerkUserId: getRequiredClerkUserId(res),
        body: parsed.data.body.trim(),
        deliveryStatus,
        emailMessageId,
      }).returning();
      await tx.update(supportTicketsTable).set({ status: "active", updatedAt: new Date() })
        .where(eq(supportTicketsTable.id, ticket.id));
      return created;
    });
    res.status(201).json(CreateAdminSupportTicketReplyResponse.parse(publicMessage(message)));
  });

  return router;
}

export default createSupportTicketsRouter();
