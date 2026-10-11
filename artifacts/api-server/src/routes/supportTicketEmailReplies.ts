import { htmlToText } from "html-to-text";
import { eq } from "drizzle-orm";
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
  normalizeSupportReplyDomain,
  normalizeSupportSender,
} from "../lib/supportTicketEmailReply";

const MAX_REPLY_LENGTH = 5000;
const MAX_PROVIDER_RESPONSE_BYTES = 2_000_000;
const RESEND_EMAIL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  text?: unknown;
  html?: unknown;
  created_at?: unknown;
};
type SupportReplyWebhookDependencies = {
  webhookSecret?: string;
  replyDomain?: string | null;
  fetchReceivedEmail?: (emailId: string) => Promise<unknown>;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

export function createSupportTicketEmailRepliesRouter(
  dependencies: SupportReplyWebhookDependencies = {},
): IRouter {
  const router: IRouter = Router();
  const webhookSecret = dependencies.webhookSecret ?? process.env.RESEND_WEBHOOK_SECRET;
  const replyDomain = normalizeSupportReplyDomain(
    dependencies.replyDomain !== undefined ? dependencies.replyDomain : process.env.RESEND_INBOUND_DOMAIN,
  );
  const retrieveEmail = dependencies.fetchReceivedEmail ?? fetchReceivedEmail;

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

    const tokens = new Set(
      getRecipients(email)
        .map((recipient) => getSupportTicketReplyToken(recipient, replyDomain))
        .filter((token): token is string => Boolean(token)),
    );
    const body = formatReceivedSupportEmailBody(email);
    if (tokens.size !== 1 || !body) {
      res.json({ ok: true, ignored: true });
      return;
    }

    const replyToken = [...tokens][0];
    const [match] = await db.select({
      ticketId: supportTicketEmailReplyTokensTable.ticketId,
      replyEmail: supportTicketsTable.replyEmail,
    }).from(supportTicketEmailReplyTokensTable)
      .innerJoin(
        supportTicketsTable,
        eq(supportTicketEmailReplyTokensTable.ticketId, supportTicketsTable.id),
      )
      .where(eq(supportTicketEmailReplyTokensTable.tokenHash, hashSupportTicketReplyToken(replyToken)))
      .limit(1);

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
      }).onConflictDoNothing({
        target: supportTicketMessagesTable.emailProviderMessageId,
      }).returning();

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
