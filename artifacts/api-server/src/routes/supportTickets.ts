import { createHash, randomBytes } from "node:crypto";
import { count, desc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateAdminSupportTicketReplyBody,
  CreateAdminSupportTicketReplyParams,
  CreateAdminSupportTicketReplyResponse,
  CreateSupportTicketBody,
  CreateSupportTicketMessageBody,
  CreateSupportTicketMessageParams,
  CreateSupportTicketMessageResponse,
  CreateSupportTicketResponse,
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
  supportTicketMessagesTable,
  supportTicketsTable,
  type SupportTicket,
  type SupportTicketMessage,
} from "@workspace/db";
import { requireAdmin } from "../lib/adminAccess";
import { getOptionalClerkUserId, getRequiredClerkUserId, requireAuthenticatedIdentity } from "../middlewares/requireAuth";

type TicketEmail = { reference: string; replyEmail: string; body: string };
type SupportTicketDependencies = {
  sendReplyEmail?: (message: TicketEmail) => Promise<void>;
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

async function sendReplyWithResend(message: TicketEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Pixl Sports Support <support@pixlsports.com>",
      to: [message.replyEmail],
      reply_to: "support@pixlsports.com",
      subject: `Update on Pixl Sports support ticket ${message.reference}`,
      text: [
        `Pixl Sports support replied to ticket ${message.reference}.`,
        "",
        message.body,
        "",
        "Sign in and open Help to review the complete ticket conversation. Replies sent from your email app are not added to the ticket.",
      ].join("\n"),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Resend rejected support reply with status ${response.status}`);
}

export function createSupportTicketsRouter(dependencies: SupportTicketDependencies = {}) {
  const router: IRouter = Router();
  const sendReplyEmail = dependencies.sendReplyEmail ?? sendReplyWithResend;
  const now = dependencies.now ?? Date.now;
  const maxRequests = dependencies.maxRequests ?? 5;
  const windowMs = dependencies.windowMs ?? 10 * 60 * 1000;
  const attempts = new Map<string, RateLimitEntry>();

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
    const reference = `PS-${new Date(timestamp).toISOString().slice(0, 10).replaceAll("-", "")}-${randomBytes(3).toString("hex").toUpperCase()}`;
    const [ticket] = await db.insert(supportTicketsTable).values({
      reference,
      ownerClerkUserId: getOptionalClerkUserId(req),
      accessTokenHash: hashToken(accessToken),
      replyEmail: parsed.data.replyEmail.trim().toLowerCase(),
      issueId: parsed.data.issueId,
      description: parsed.data.description.trim(),
      deviceType: parsed.data.deviceType,
      connectionType: parsed.data.connectionType,
      diagnostics: parsed.data.diagnostics ?? null,
    }).returning();
    res.status(201).json(CreateSupportTicketResponse.parse({
      ticket: publicTicket(ticket),
      accessToken,
    }));
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

  router.get("/admin/support/tickets", requireAdmin, async (req, res): Promise<void> => {
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

  router.get("/admin/support/tickets/:ticketId", requireAdmin, async (req, res): Promise<void> => {
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

  router.patch("/admin/support/tickets/:ticketId", requireAdmin, async (req, res): Promise<void> => {
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

  router.post("/admin/support/tickets/:ticketId/replies", requireAdmin, async (req, res): Promise<void> => {
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
    try {
      await sendReplyEmail({ reference: ticket.reference, replyEmail: ticket.replyEmail, body: parsed.data.body.trim() });
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
