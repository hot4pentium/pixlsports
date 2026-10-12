import { htmlToText } from "html-to-text";
import { and, eq, inArray, lt } from "drizzle-orm";
import { Webhook } from "svix";
import { Router, type IRouter, type Request } from "express";
import {
  db,
  supportTicketEmailReplyTokensTable,
  supportTicketEmailReplyRejectionsTable,
  supportTicketMessagesTable,
  supportTicketMessageAttachmentsTable,
  supportTicketsTable,
  type SupportTicketEmailReplyRejectionReason,
} from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  getSupportTicketReplyToken,
  hashSupportTicketReplyToken,
  normalizeSupportEmailMessageId,
  normalizeSupportReplyDomain,
  normalizeSupportSender,
} from "../lib/supportTicketEmailReply";

const MAX_REPLY_LENGTH = 5000;
const MAX_PROVIDER_RESPONSE_BYTES = 2_000_000;
const MAX_EMAIL_ATTACHMENTS = 5;
const MAX_EMAIL_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_EMAIL_ATTACHMENT_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_LEGACY_SENT_EMAIL_PAGES = 20;
const RESEND_EMAIL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESEND_ATTACHMENT_ID_PATTERN = RESEND_EMAIL_ID_PATTERN;
const LEGACY_SUPPORT_ADDRESS = "support@pixlsports.com";
const LEGACY_TICKET_SUBJECT = /^Update on Pixl Sports support ticket (PS-[A-Z0-9-]{6,32})$/i;

const REJECTION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SUPPORTED_ATTACHMENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

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
  attachments?: unknown;
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
  listReceivedAttachments?: (emailId: string) => Promise<ReceivedAttachmentList>;
  downloadReceivedAttachment?: (emailId: string, attachmentId: string, downloadUrl: string) => Promise<Buffer>;
  saveAttachment?: (contents: Buffer, contentType: string) => Promise<string>;
  deleteAttachment?: (objectPath: string) => Promise<void>;
};

class OversizedReceivedEmailError extends Error {}
class OversizedAttachmentError extends Error {}

type ReceivedAttachmentList = { items: unknown[]; hasMore: boolean };
type AttachmentPlan = {
  providerAttachmentId: string | null;
  filename: string;
  contentType: string;
  size: number | null;
  status: "processing" | "unsupported" | "too_large" | "unavailable" | "too_many";
  downloadUrl?: string;
};
type AttachmentStorage = {
  download: (emailId: string, attachmentId: string, downloadUrl: string) => Promise<Buffer>;
  save: (contents: Buffer, contentType: string) => Promise<string>;
  remove: (objectPath: string) => Promise<void>;
};

const objectStorageService = new ObjectStorageService();

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

async function listReceivedEmailAttachments(emailId: string): Promise<ReceivedAttachmentList> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");

  const url = new URL(
    `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}/attachments`,
  );
  url.searchParams.set("limit", String(MAX_EMAIL_ATTACHMENTS + 1));
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Resend rejected received-email attachment lookup with status ${response.status}`);
  }
  let result: unknown;
  try {
    result = JSON.parse(await readLimitedResponseBody(response)) as unknown;
  } catch {
    throw new Error("Resend returned invalid received-email attachment content.");
  }
  if (!isRecord(result) || !Array.isArray(result.data)) {
    throw new Error("Resend returned invalid received-email attachment content.");
  }
  return { items: result.data, hasMore: result.has_more === true };
}

async function readLimitedBinaryResponse(response: Response, maxBytes: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new OversizedAttachmentError("Email attachment exceeded the processing limit.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function downloadReceivedEmailAttachment(
  _emailId: string,
  _attachmentId: string,
  downloadUrl: string,
): Promise<Buffer> {
  const url = new URL(downloadUrl);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "inbound-cdn.resend.com" ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error("Resend returned an invalid attachment download URL.");
  }
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Resend attachment download failed with status ${response.status}`);
  }
  return readLimitedBinaryResponse(response, MAX_EMAIL_ATTACHMENT_BYTES);
}

function sanitizeAttachmentFilename(value: unknown, index: number): string {
  if (typeof value !== "string") return `Attachment ${index + 1}`;
  const cleaned = value
    .replace(/[\\/\u0000-\u001f\u007f]/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180);
  return cleaned || `Attachment ${index + 1}`;
}

function normalizedAttachmentContentType(value: unknown): string {
  if (typeof value !== "string") return "application/octet-stream";
  const contentType = value.split(";", 1)[0].trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(contentType)
    ? contentType
    : "application/octet-stream";
}

function safeAttachmentSize(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 2_147_483_647
    ? value
    : null;
}

function isResendDownloadUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "inbound-cdn.resend.com" &&
      !url.username &&
      !url.password &&
      !url.port;
  } catch {
    return false;
  }
}

function attachmentPlan(
  value: unknown,
  index: number,
  forceUnavailable = false,
): AttachmentPlan {
  const record = isRecord(value) ? value : {};
  const filename = sanitizeAttachmentFilename(record.filename, index);
  const contentType = normalizedAttachmentContentType(record.content_type ?? record.contentType);
  const size = safeAttachmentSize(record.size);
  const providerAttachmentId =
    typeof record.id === "string" && RESEND_ATTACHMENT_ID_PATTERN.test(record.id)
      ? record.id
      : null;
  const downloadUrl = record.download_url ?? record.downloadUrl;

  let status: AttachmentPlan["status"] = "processing";
  if (!SUPPORTED_ATTACHMENT_TYPES.has(contentType)) status = "unsupported";
  else if (size !== null && size > MAX_EMAIL_ATTACHMENT_BYTES) status = "too_large";
  else if (
    forceUnavailable ||
    !providerAttachmentId ||
    !isResendDownloadUrl(downloadUrl)
  ) {
    status = "unavailable";
  }

  return {
    providerAttachmentId,
    filename,
    contentType,
    size,
    status,
    ...(status === "processing" && typeof downloadUrl === "string" ? { downloadUrl } : {}),
  };
}

function buildAttachmentPlans(
  attachments: unknown[],
  hasMore: boolean,
  forceUnavailable = false,
): AttachmentPlan[] {
  const plans = attachments
    .slice(0, MAX_EMAIL_ATTACHMENTS)
    .map((attachment, index) => attachmentPlan(attachment, index, forceUnavailable));
  if (hasMore || attachments.length > MAX_EMAIL_ATTACHMENTS) {
    plans.push({
      providerAttachmentId: null,
      filename: "Additional attachments",
      contentType: "application/octet-stream",
      size: null,
      status: "too_many",
    });
  }
  return plans;
}

function sniffAttachmentContentType(contents: Buffer): string | undefined {
  if (
    contents.length >= 8 &&
    contents.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) return "image/png";
  if (
    contents.length >= 3 &&
    contents[0] === 0xff &&
    contents[1] === 0xd8 &&
    contents[2] === 0xff
  ) return "image/jpeg";
  if (
    contents.length >= 12 &&
    contents.toString("ascii", 0, 4) === "RIFF" &&
    contents.toString("ascii", 8, 12) === "WEBP"
  ) return "image/webp";
  if (contents.length >= 5 && contents.toString("ascii", 0, 5) === "%PDF-") {
    return "application/pdf";
  }
  return undefined;
}

async function processReceivedAttachments(
  emailId: string,
  plans: AttachmentPlan[],
  rows: Array<{ id: string }>,
  storage: AttachmentStorage,
  log: { warn: (obj: object, message: string) => void; error: (obj: object, message: string) => void },
): Promise<void> {
  let storedBytes = 0;
  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index];
    const row = rows[index];
    if (!row || plan.status !== "processing" || !plan.providerAttachmentId || !plan.downloadUrl) continue;

    let objectPath: string | undefined;
    try {
      const contents = await storage.download(emailId, plan.providerAttachmentId, plan.downloadUrl);
      if (!contents.length) throw new Error("Received email attachment was empty.");
      if (contents.length > MAX_EMAIL_ATTACHMENT_BYTES) {
        throw new OversizedAttachmentError("Email attachment exceeded the processing limit.");
      }
      if (storedBytes + contents.length > MAX_EMAIL_ATTACHMENT_TOTAL_BYTES) {
        await db.update(supportTicketMessageAttachmentsTable)
          .set({ status: "too_large", size: contents.length })
          .where(eq(supportTicketMessageAttachmentsTable.id, row.id));
        continue;
      }

      const detectedType = sniffAttachmentContentType(contents);
      if (!detectedType || detectedType !== plan.contentType) {
        await db.update(supportTicketMessageAttachmentsTable)
          .set({ status: "unsupported", size: contents.length })
          .where(eq(supportTicketMessageAttachmentsTable.id, row.id));
        continue;
      }

      objectPath = await storage.save(contents, detectedType);
      await db.update(supportTicketMessageAttachmentsTable)
        .set({
          status: "available",
          objectPath,
          contentType: detectedType,
          size: contents.length,
        })
        .where(eq(supportTicketMessageAttachmentsTable.id, row.id));
      storedBytes += contents.length;
    } catch (error) {
      if (objectPath) {
        await storage.remove(objectPath).catch((deleteError) => {
          log.error({ err: deleteError }, "Unable to remove an unlinked support email attachment");
        });
      }
      const status = error instanceof OversizedAttachmentError ? "too_large" : "unavailable";
      await db.update(supportTicketMessageAttachmentsTable)
        .set({ status })
        .where(eq(supportTicketMessageAttachmentsTable.id, row.id))
        .catch((updateError) => {
          log.error({ err: updateError }, "Unable to record support email attachment status");
        });
      log.warn(
        { attachmentId: plan.providerAttachmentId, status },
        "Unable to store a support email attachment",
      );
    }
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

async function recordRejectedReply(
  emailProviderId: string,
  reason: SupportTicketEmailReplyRejectionReason,
): Promise<void> {
  await db.delete(supportTicketEmailReplyRejectionsTable)
    .where(lt(
      supportTicketEmailReplyRejectionsTable.rejectedAt,
      new Date(Date.now() - REJECTION_RETENTION_MS),
    ));
  await db.insert(supportTicketEmailReplyRejectionsTable)
    .values({ emailProviderId, reason })
    .onConflictDoNothing();
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
): Promise<{
  match?: { ticketId: string; replyEmail: string };
  ambiguous: boolean;
}> {
  const sender = normalizeSupportSender(email.from as string);
  if (
    !getRecipients(email).some((recipient) => normalizeSupportSender(recipient) === LEGACY_SUPPORT_ADDRESS)
  ) {
    return { ambiguous: false };
  }

  const threadMessageIds = getThreadMessageIds(email);
  if (!threadMessageIds.length) return { ambiguous: false };

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
  let ambiguous = false;
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
    if (sentEmails.length !== 1) {
      ambiguous = true;
      continue;
    }
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

  if (ticketMatches.size > 1) return { ambiguous: true };
  return { match: ticketMatches.size === 1 ? [...ticketMatches.values()][0] : undefined, ambiguous };
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
  const listAttachments = dependencies.listReceivedAttachments ?? listReceivedEmailAttachments;
  const attachmentStorage: AttachmentStorage = {
    download: dependencies.downloadReceivedAttachment ?? downloadReceivedEmailAttachment,
    save: dependencies.saveAttachment ?? ((contents, contentType) =>
      objectStorageService.saveSupportTicketAttachment(contents, contentType)),
    remove: dependencies.deleteAttachment ?? ((objectPath) =>
      objectStorageService.deleteObjectEntity(objectPath)),
  };

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

    let listedAttachments: ReceivedAttachmentList | undefined;
    try {
      listedAttachments = await listAttachments(emailId);
    } catch (error) {
      req.log.warn({ err: error, emailId }, "Unable to list support email attachments");
    }
    const embeddedAttachments = Array.isArray(email.attachments) ? email.attachments : [];
    const attachmentList = listedAttachments;
    const useEmbeddedAttachments = !attachmentList || attachmentList.items.length === 0;
    const rawAttachments = useEmbeddedAttachments
      ? embeddedAttachments
      : attachmentList.items;
    const hasAttachmentSignal = rawAttachments.length > 0 || attachmentList?.hasMore === true;
    const body = formatReceivedSupportEmailBody(email) ?? (
      hasAttachmentSignal
        ? rawAttachments.length === 1
          ? "Customer sent an attachment without a message."
          : "Customer sent attachments without a message."
        : undefined
    );
    if (!body) {
      res.json({ ok: true, ignored: true });
      return;
    }
    const attachmentPlans = buildAttachmentPlans(
      rawAttachments,
      attachmentList?.hasMore === true,
      useEmbeddedAttachments,
    );

    const tokens = new Set(
      getRecipients(email)
        .map((recipient) => getSupportTicketReplyToken(recipient, replyDomain))
        .filter((token): token is string => Boolean(token)),
    );

    let match: { ticketId: string; replyEmail: string } | undefined;
    let ambiguousLegacyThread = false;
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
        const legacyMatch = await findLegacyTicket(email, findSentEmails);
        match = legacyMatch.match;
        ambiguousLegacyThread = legacyMatch.ambiguous;
      } catch (error) {
        req.log.error({ err: error }, "Unable to correlate legacy support email reply");
        res.status(503).json({ error: "Could not verify the support email reply thread." });
        return;
      }
    }

    const senderMatchesTicket = Boolean(
      match && normalizeSupportSender(email.from) === match.replyEmail.trim().toLowerCase(),
    );
    if (!match || !senderMatchesTicket) {
      const reason: SupportTicketEmailReplyRejectionReason = !match
        ? tokens.size > 1 || ambiguousLegacyThread
          ? "ambiguous_reply_address"
          : tokens.size === 1
            ? "unknown_reply_address"
            : "unmatched_legacy_thread"
        : "sender_mismatch";
      try {
        await recordRejectedReply(emailId, reason);
      } catch {
        req.log.error({ reason }, "Unable to record rejected support email reply");
        res.status(503).json({ error: "Could not record the received support email." });
        return;
      }
      req.log.warn({ reason }, "Support email reply could not be matched");
      res.json({ ok: true, ignored: true });
      return;
    }

    const imported = await db.transaction(async (tx) => {
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

      const attachments = attachmentPlans.length
        ? await tx.insert(supportTicketMessageAttachmentsTable).values(
            attachmentPlans.map((attachment) => ({
              messageId: message.id,
              providerAttachmentId: attachment.providerAttachmentId,
              filename: attachment.filename,
              contentType: attachment.contentType,
              size: attachment.size,
              status: attachment.status,
            })),
          ).returning({ id: supportTicketMessageAttachmentsTable.id })
        : [];

      await tx.update(supportTicketsTable)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(supportTicketsTable.id, match.ticketId));
      return { message, attachments };
    });

    if (imported && imported.attachments.length) {
      await processReceivedAttachments(
        emailId,
        attachmentPlans,
        imported.attachments,
        attachmentStorage,
        req.log,
      );
    }

    res.json({ ok: true, imported: Boolean(imported) });
  });

  return router;
}

export default createSupportTicketEmailRepliesRouter();
