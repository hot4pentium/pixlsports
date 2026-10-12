import { htmlToText } from "html-to-text";
import { and, eq, inArray } from "drizzle-orm";
import { Webhook } from "svix";
import { Router, type IRouter, type Request } from "express";
import {
  db,
  supportTicketEmailReplyTokensTable,
  supportTicketMessagesTable,
  supportTicketsTable,
} from "@workspace/db";
import {
  getSupportTicketReplyToken,
  hashSupportTicketReplyToken,
  normalizeSupportEmailMessageId,
  normalizeSupportReplyDomain,
  normalizeSupportSender,
} from "../lib/supportTicketEmailReply";

const MAX_REPLY_LENGTH = 5000;
const MAX_PROVIDER_RESPONSE_BYTES = 2_000_000;
const MAX_LEGACY_SENT_EMAIL_PAGES = 20;
const RESEND_EMAIL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_SUPPORT_ADDRESS = "support@pixlsports.com";
const LEGACY_TICKET_SUBJECT = /^Update on Pixl Sports support ticket (PS-[A-Z0-9-]{6,32})$/i;

type RawBodyRequest = Request & { rawBody?: Buffer };
type WebhookHeaders = {
  "svix-id": string;
  "svix-timestamp": string;
  "svix-signature": string;
};
type ReceivedEmail = {
  id?: unknown;
  from?: unknown;
  to?: unknown;
  headers?: unknown;
  authentication?: unknown;
  message_id?: unknown;
  text?: unknown;
  html?: unknown;
  created_at?: unknown;
};
type SentEmail = {
  id?: unknown;
  message_id?: unknown;
  from?: unknown;
  to?: unknown;
  reply_to?: unknown;
  subject?: unknown;
};
type SupportReplyWebhookDependencies = {
  webhookSecret?: string;
  replyDomain?: string | null;
  fetchReceivedEmail?: (emailId: string) => Promise<unknown>;
  findSentEmailsByMessageIds?: (messageIds: string[]) => Promise<unknown[]>;
};

class OversizedReceivedEmailError extends Error {}

async function readLimitedResponseBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_PROVIDER_RESPONSE_BYTES) {
      await reader.cancel();
      throw new OversizedReceivedEmailError("Received email content exceeded the processing limit.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchReceivedEmail(emailId: string): Promise<unknown> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");

  const response = await fetch(
    `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}?html_format=cid`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Resend rejected received-email lookup with status ${response.status}`);
  }
  const body = await readLimitedResponseBody(response);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error("Resend returned invalid received-email content.");
  }
}

async function findResendSentEmailsByMessageIds(messageIds: string[]): Promise<unknown[]> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");

  const sought = new Set(messageIds);
  const matches: unknown[] = [];
  let after: string | undefined;
  const signal = AbortSignal.timeout(10_000);
  for (let page = 0; page < MAX_LEGACY_SENT_EMAIL_PAGES; page += 1) {
    const url = new URL("https://api.resend.com/emails");
    url.searchParams.set("limit", "100");
    if (after) url.searchParams.set("after", after);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    if (!response.ok) {
      throw new Error(`Resend rejected sent-email lookup with status ${response.status}`);
    }
    const responseBody = await readLimitedResponseBody(response);
    let result: unknown;
    try {
      result = JSON.parse(responseBody) as unknown;
    } catch {
      throw new Error("Resend returned invalid sent-email content.");
    }
    if (!isRecord(result) || !Array.isArray(result.data)) {
      throw new Error("Resend returned invalid sent-email content.");
    }

    for (const sentEmail of result.data) {
      if (!isRecord(sentEmail)) continue;
      const messageId = normalizeMessageId(sentEmail.message_id);
      if (messageId && sought.has(messageId)) matches.push(sentEmail);
    }
    if (matches.length >= sought.size || result.has_more !== true) break;

    const last = result.data.at(-1);
    if (!isRecord(last) || typeof last.id !== "string" || !last.id) break;
    after = last.id;
  }
  return matches;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeMessageId(value: unknown): string | undefined {
  return normalizeSupportEmailMessageId(value);
}

function messageIdsFromHeader(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  const messageIds = new Set<string>();
  for (const item of values) {
    if (typeof item !== "string") continue;
    const matches = item.match(/<[^<>\s]+@[^<>\s]+>/g) ?? [];
    for (const match of matches) {
      const messageId = normalizeMessageId(match);
      if (messageId) messageIds.add(messageId);
    }
    if (matches.length === 0) {
      const messageId = normalizeMessageId(item);
      if (messageId) messageIds.add(messageId);
    }
  }
  return [...messageIds];
}

function getThreadMessageIds(email: ReceivedEmail): string[] {
  if (!isRecord(email.headers)) return [];
  const headers = new Map(
    Object.entries(email.headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return [...new Set([
    ...messageIdsFromHeader(headers.get("in-reply-to")),
    ...messageIdsFromHeader(headers.get("references")),
  ])];
}

function hasVerifiedSender(email: ReceivedEmail): boolean {
  return isRecord(email.authentication) && email.authentication.dmarc === "pass";
}

function extractEmailId(event: unknown): string | undefined {
  if (!isRecord(event) || event.type !== "email.received" || !isRecord(event.data)) return undefined;
  const emailId = event.data.email_id;
  return typeof emailId === "string" && RESEND_EMAIL_ID_PATTERN.test(emailId) ? emailId : undefined;
}

export function formatReceivedSupportEmailBody(email: ReceivedEmail): string | undefined {
  let body = typeof email.text === "string" ? email.text : "";
  if (!body.trim() && typeof email.html === "string") {
    body = htmlToText(email.html, { wordwrap: false });
  }
  body = body.replace(/\r\n?/g, "\n").trim();
  if (!body) return undefined;

  const characters = Array.from(body);
  if (characters.length <= MAX_REPLY_LENGTH) return body;
  const truncationNotice = "\n\n[Email reply shortened to fit the support thread.]";
  return `${characters.slice(0, MAX_REPLY_LENGTH - Array.from(truncationNotice).length).join("").trimEnd()}${truncationNotice}`;
}

function getRecipients(email: ReceivedEmail): string[] {
  if (!Array.isArray(email.to)) return [];
  return email.to.filter((recipient): recipient is string => typeof recipient === "string");
}

function sentEmailTicketReference(sentEmail: SentEmail, sender: string): string | undefined {
  const replyTo = Array.isArray(sentEmail.reply_to)
    ? sentEmail.reply_to
    : typeof sentEmail.reply_to === "string"
      ? [sentEmail.reply_to]
      : [];
  if (
    typeof sentEmail.from !== "string" ||
    normalizeSupportSender(sentEmail.from) !== LEGACY_SUPPORT_ADDRESS ||
    !replyTo.some((recipient) =>
      typeof recipient === "string" && normalizeSupportSender(recipient) === LEGACY_SUPPORT_ADDRESS
    ) ||
    !Array.isArray(sentEmail.to) ||
    !sentEmail.to.some((recipient) =>
      typeof recipient === "string" && normalizeSupportSender(recipient) === sender
    ) ||
    typeof sentEmail.subject !== "string"
  ) {
    return undefined;
  }
  return sentEmail.subject.match(LEGACY_TICKET_SUBJECT)?.[1]?.toUpperCase();
}

async function findLegacyTicket(
  email: ReceivedEmail,
  findSentEmails: (messageIds: string[]) => Promise<unknown[]>,
): Promise<{ ticketId: string; replyEmail: string } | undefined> {
  const sender = normalizeSupportSender(email.from as string);
  if (
    !getRecipients(email).some((recipient) => normalizeSupportSender(recipient) === LEGACY_SUPPORT_ADDRESS)
  ) {
    return undefined;
  }

  const threadMessageIds = getThreadMessageIds(email);
  if (!threadMessageIds.length) return undefined;

  const storedMatches = await db.select({
    ticketId: supportTicketMessagesTable.ticketId,
    replyEmail: supportTicketsTable.replyEmail,
    messageId: supportTicketMessagesTable.emailMessageId,
  }).from(supportTicketMessagesTable)
    .innerJoin(
      supportTicketsTable,
      eq(supportTicketMessagesTable.ticketId, supportTicketsTable.id),
    )
    .where(and(
      inArray(supportTicketMessagesTable.emailMessageId, threadMessageIds),
      eq(supportTicketMessagesTable.senderRole, "admin"),
    ));

  const trustedStoredMatches = storedMatches.filter((match) =>
    match.replyEmail.trim().toLowerCase() === sender
  );
  const storedMessageIds = new Set(trustedStoredMatches.map((match) => match.messageId).filter(Boolean));
  const unresolvedMessageIds = threadMessageIds.filter((messageId) => !storedMessageIds.has(messageId));
  const sentEmailMatches = unresolvedMessageIds.length
    ? await findSentEmails(unresolvedMessageIds)
    : [];

  const ticketMatches = new Map<string, { ticketId: string; replyEmail: string }>();
  for (const match of trustedStoredMatches) {
    ticketMatches.set(match.ticketId, { ticketId: match.ticketId, replyEmail: match.replyEmail });
  }

  const recordsByMessageId = new Map<string, SentEmail[]>();
  for (const sentEmail of sentEmailMatches) {
    if (!isRecord(sentEmail)) continue;
    const messageId = normalizeMessageId(sentEmail.message_id);
    if (!messageId || !unresolvedMessageIds.includes(messageId)) continue;
    const records = recordsByMessageId.get(messageId) ?? [];
    records.push(sentEmail as SentEmail);
    recordsByMessageId.set(messageId, records);
  }

  for (const sentEmails of recordsByMessageId.values()) {
    // A repeated or conflicting provider record is ambiguous; do not choose one.
    if (sentEmails.length !== 1) continue;
    const reference = sentEmailTicketReference(sentEmails[0], sender);
    if (!reference) continue;
    const [ticket] = await db.select({
      id: supportTicketsTable.id,
      replyEmail: supportTicketsTable.replyEmail,
    }).from(supportTicketsTable)
      .where(and(
        eq(supportTicketsTable.reference, reference),
        eq(supportTicketsTable.replyEmail, sender),
      ))
      .limit(1);
    if (ticket) ticketMatches.set(ticket.id, { ticketId: ticket.id, replyEmail: ticket.replyEmail });
  }

  return ticketMatches.size === 1 ? [...ticketMatches.values()][0] : undefined;
}

export function createSupportTicketEmailRepliesRouter(
  dependencies: SupportReplyWebhookDependencies = {},
): IRouter {
  const router: IRouter = Router();
  const webhookSecret = dependencies.webhookSecret ?? process.env.RESEND_WEBHOOK_SECRET;
  const replyDomain = normalizeSupportReplyDomain(
    dependencies.replyDomain !== undefined ? dependencies.replyDomain : process.env.RESEND_INBOUND_DOMAIN,
  );
  const retrieveEmail = dependencies.fetchReceivedEmail ?? fetchReceivedEmail;
  const findSentEmails = dependencies.findSentEmailsByMessageIds ?? findResendSentEmailsByMessageIds;

  router.post("/support/tickets/email-replies/resend", async (req, res): Promise<void> => {
    if (!webhookSecret) {
      res.status(503).json({ error: "Support email replies are not configured." });
      return;
    }

    const rawBody = (req as RawBodyRequest).rawBody;
    const headers: WebhookHeaders = {
      "svix-id": req.get("svix-id") ?? "",
      "svix-timestamp": req.get("svix-timestamp") ?? "",
      "svix-signature": req.get("svix-signature") ?? "",
    };
    if (!rawBody || !headers["svix-id"] || !headers["svix-timestamp"] || !headers["svix-signature"]) {
      res.status(401).json({ error: "Invalid Resend webhook signature." });
      return;
    }

    let event: unknown;
    try {
      new Webhook(webhookSecret).verify(rawBody.toString("utf8"), headers);
      event = req.body as unknown;
    } catch {
      res.status(401).json({ error: "Invalid Resend webhook signature." });
      return;
    }

    const emailId = extractEmailId(event);
    if (!emailId) {
      res.json({ ok: true, ignored: true });
      return;
    }
    if (!replyDomain) {
      res.status(503).json({ error: "Support email replies are not configured." });
      return;
    }

    let receivedEmail: unknown;
    try {
      receivedEmail = await retrieveEmail(emailId);
    } catch (error) {
      if (error instanceof OversizedReceivedEmailError) {
        req.log.warn({ reason: "oversized_received_email" }, "Ignoring oversized support email reply");
        res.json({ ok: true, ignored: true });
        return;
      }
      req.log.error({ err: error }, "Unable to retrieve received support email from Resend");
      res.status(503).json({ error: "Could not retrieve the received support email." });
      return;
    }

    if (!isRecord(receivedEmail)) {
      res.json({ ok: true, ignored: true });
      return;
    }
    const email = receivedEmail as ReceivedEmail;
    if (email.id !== emailId || typeof email.from !== "string") {
      res.json({ ok: true, ignored: true });
      return;
    }
    if (!hasVerifiedSender(email)) {
      res.json({ ok: true, ignored: true });
      return;
    }

    const tokens = new Set(
      getRecipients(email)
        .map((recipient) => getSupportTicketReplyToken(recipient, replyDomain))
        .filter((token): token is string => Boolean(token)),
    );
    const body = formatReceivedSupportEmailBody(email);
    if (!body) {
      res.json({ ok: true, ignored: true });
      return;
    }

    let match: { ticketId: string; replyEmail: string } | undefined;
    if (tokens.size === 1) {
      const replyToken = [...tokens][0];
      [match] = await db.select({
        ticketId: supportTicketEmailReplyTokensTable.ticketId,
        replyEmail: supportTicketsTable.replyEmail,
      }).from(supportTicketEmailReplyTokensTable)
        .innerJoin(
          supportTicketsTable,
          eq(supportTicketEmailReplyTokensTable.ticketId, supportTicketsTable.id),
        )
        .where(eq(supportTicketEmailReplyTokensTable.tokenHash, hashSupportTicketReplyToken(replyToken)))
        .limit(1);
    } else if (tokens.size === 0) {
      try {
        match = await findLegacyTicket(email, findSentEmails);
      } catch (error) {
        req.log.error({ err: error }, "Unable to correlate legacy support email reply");
        res.status(503).json({ error: "Could not verify the support email reply thread." });
        return;
      }
    }

    if (!match || normalizeSupportSender(email.from) !== match.replyEmail.trim().toLowerCase()) {
      res.json({ ok: true, ignored: true });
      return;
    }

    const created = await db.transaction(async (tx) => {
      const [message] = await tx.insert(supportTicketMessagesTable).values({
        ticketId: match.ticketId,
        senderRole: "member",
        senderClerkUserId: null,
        body,
        deliveryStatus: "not_applicable",
        emailProviderMessageId: emailId,
        emailMessageId: normalizeMessageId(email.message_id),
      }).onConflictDoNothing().returning();

      if (!message) return undefined;

      await tx.update(supportTicketsTable)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(supportTicketsTable.id, match.ticketId));
      return message;
    });

    res.json({ ok: true, imported: Boolean(created) });
  });

  return router;
}

export default createSupportTicketEmailRepliesRouter();
