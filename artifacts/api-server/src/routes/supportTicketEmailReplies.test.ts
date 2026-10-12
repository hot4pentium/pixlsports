import assert from "node:assert/strict";
import { createHmac, createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import express, { type Request } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  supportTicketEmailReplyTokensTable,
  supportTicketMessagesTable,
  supportTicketMessageAttachmentsTable,
  supportTicketsTable,
} from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  buildSupportTicketReplyAddress,
  getSupportTicketReplyToken,
  hashSupportTicketReplyToken,
} from "../lib/supportTicketEmailReply";
import { createSupportTicketsRouter } from "./supportTickets";
import {
  createSupportTicketEmailRepliesRouter,
  formatReceivedSupportEmailBody,
} from "./supportTicketEmailReplies";

const replyDomain = "inbound.example.resend.app";
const replyEmail = "family@example.com";
const legacySupportAddress = "support@pixlsports.com";
const adminUserId = "support-reply-test-admin";

type TestAttachmentDependencies = {
  listAttachments?: (emailId: string) => Promise<{ items: unknown[]; hasMore: boolean }>;
  downloadAttachment?: (emailId: string, attachmentId: string, downloadUrl: string) => Promise<Buffer>;
  saveAttachment?: (contents: Buffer, contentType: string) => Promise<string>;
};

function createTestServer(
  webhookSecret: string,
  fetchReceivedEmail: (emailId: string) => Promise<unknown>,
  onAdminReply?: (message: { reference: string; replyEmail: string; body: string; replyTo?: string }) => Promise<{ messageId?: string } | void>,
  findSentEmailsByMessageIds?: (messageIds: string[]) => Promise<unknown[]>,
  attachmentDependencies: TestAttachmentDependencies = {},
) {
  const app = express();
  app.use(express.json({
    verify: (req, _res, buffer) => {
      (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
    },
  }));
  app.use((req, res, next) => {
    const auth = () => ({ userId: null, tokenType: "session_token" });
    (auth as any)[Symbol.for("@clerk/express.auth")] = true;
    (req as any).auth = auth;
    (req as any).log = { error: () => undefined, warn: () => undefined };
    next();
  });
  app.use("/api", createSupportTicketEmailRepliesRouter({
    webhookSecret,
    replyDomain,
    fetchReceivedEmail,
    findSentEmailsByMessageIds,
    listReceivedAttachments: attachmentDependencies.listAttachments ?? (async () => ({ items: [], hasMore: false })),
    downloadReceivedAttachment: attachmentDependencies.downloadAttachment,
    saveAttachment: attachmentDependencies.saveAttachment,
  }));
  app.use("/api", createSupportTicketsRouter({
    supportReplyDomain: onAdminReply ? replyDomain : null,
    sendReplyEmail: onAdminReply,
    requireAdmin: (_req, res, next) => {
      res.locals.clerkUserId = adminUserId;
      next();
    },
  }));
  return app.listen(0);
}

async function closeServer(server: ReturnType<typeof createTestServer>) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function createTicket() {
  const token = randomBytes(32).toString("base64url");
  const [ticket] = await db.insert(supportTicketsTable).values({
    reference: `PS-${randomBytes(5).toString("hex").toUpperCase()}`,
    ownerClerkUserId: null,
    accessTokenHash: createHash("sha256").update(token).digest("hex"),
    replyEmail,
    issueId: "other",
    description: "Support email reply integration test.",
    deviceType: "desktop",
    connectionType: "wifi",
  }).returning();
  return { ticket, accessToken: token };
}

async function deleteTicket(ticketId: string) {
  await db.delete(supportTicketsTable).where(eq(supportTicketsTable.id, ticketId));
}

function createWebhookPayload(emailId: string) {
  return JSON.stringify({
    type: "email.received",
    created_at: new Date().toISOString(),
    data: { email_id: emailId },
  });
}

function signWebhook(secret: string, body: string) {
  const id = `msg_${randomUUID().replaceAll("-", "")}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const signature = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return {
    "content-type": "application/json",
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${signature}`,
  };
}

test("signed customer replies are imported once into the matching ticket thread", async () => {
  const secret = `whsec_${randomBytes(32).toString("base64")}`;
  const { ticket, accessToken } = await createTicket();
  const replyToken = randomBytes(28).toString("hex");
  const emailId = randomUUID();
  await db.insert(supportTicketEmailReplyTokensTable).values({
    ticketId: ticket.id,
    tokenHash: hashSupportTicketReplyToken(replyToken),
  });
  const server = createTestServer(secret, async (requestedId) => ({
    id: requestedId,
    from: replyEmail,
    to: [buildSupportTicketReplyAddress(replyToken, replyDomain)],
    text: "Thanks, I can reproduce this on my phone.",
    authentication: { spf: "pass", dkim: "pass", dmarc: "pass" },
    message_id: `<reply-${emailId}@example.com>`,
  }));

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const body = createWebhookPayload(emailId);
    const headers = signWebhook(secret, body);
    const post = () => fetch(`http://127.0.0.1:${address.port}/api/support/tickets/email-replies/resend`, {
      method: "POST",
      headers,
      body,
    });

    const first = await post();
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { ok: true, imported: true });
    const duplicate = await post();
    assert.equal(duplicate.status, 200);
    assert.deepEqual(await duplicate.json(), { ok: true, imported: false });

    const messages = await db.select().from(supportTicketMessagesTable)
      .where(eq(supportTicketMessagesTable.ticketId, ticket.id));
    assert.equal(messages.length, 1);
    assert.equal(messages[0].senderRole, "member");
    assert.equal(messages[0].senderClerkUserId, null);
    assert.equal(messages[0].body, "Thanks, I can reproduce this on my phone.");
    assert.equal(messages[0].emailProviderMessageId, emailId);
    assert.equal(messages[0].emailMessageId, `reply-${emailId}@example.com`.toLowerCase());

    const storedTicket = await db.select().from(supportTicketsTable)
      .where(eq(supportTicketsTable.id, ticket.id));
    assert.equal(storedTicket[0].status, "active");

    const detail = await fetch(
      `http://127.0.0.1:${address.port}/api/support/tickets/${ticket.id}`,
      { headers: { "x-support-ticket-token": accessToken } },
    );
    assert.equal(detail.status, 200);
    const publicTicket = await detail.json() as { messages: Array<{ body: string; senderRole: string }> };
    assert.deepEqual(publicTicket.messages.map(({ body: messageBody, senderRole }) => ({ body: messageBody, senderRole })), [
      { body: "Thanks, I can reproduce this on my phone.", senderRole: "member" },
    ]);
  } finally {
    await closeServer(server);
    await deleteTicket(ticket.id);
  }
});

test("email replies are ignored when the ticket token or sender does not match", async () => {
  const secret = `whsec_${randomBytes(32).toString("base64")}`;
  const { ticket } = await createTicket();
  const replyToken = randomBytes(28).toString("hex");
  const unknownToken = randomBytes(28).toString("hex");
  const emailIds = [randomUUID(), randomUUID()];
  await db.insert(supportTicketEmailReplyTokensTable).values({
    ticketId: ticket.id,
    tokenHash: hashSupportTicketReplyToken(replyToken),
  });
  const emails = new Map<string, unknown>([
    [emailIds[0], {
      id: emailIds[0],
      from: "stranger@example.com",
      to: [buildSupportTicketReplyAddress(replyToken, replyDomain)],
      text: "This should not be imported.",
      authentication: { spf: "pass", dkim: "pass", dmarc: "pass" },
    }],
    [emailIds[1], {
      id: emailIds[1],
      from: replyEmail,
      to: [buildSupportTicketReplyAddress(unknownToken, replyDomain)],
      text: "This should not be imported either.",
      authentication: { spf: "pass", dkim: "pass", dmarc: "pass" },
    }],
  ]);
  const server = createTestServer(secret, async (emailId) => emails.get(emailId));

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    for (const emailId of emailIds) {
      const body = createWebhookPayload(emailId);
      const response: globalThis.Response = await fetch(`http://127.0.0.1:${address.port}/api/support/tickets/email-replies/resend`, {
        method: "POST",
        headers: signWebhook(secret, body),
        body,
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, ignored: true });
    }

    const messages = await db.select().from(supportTicketMessagesTable)
      .where(eq(supportTicketMessagesTable.ticketId, ticket.id));
    assert.equal(messages.length, 0);
  } finally {
    await closeServer(server);
    await deleteTicket(ticket.id);
  }
});

test("legacy support-address replies match a unique authenticated sent-email thread", async () => {
  const secret = `whsec_${randomBytes(32).toString("base64")}`;
  const { ticket } = await createTicket();
  const inboundEmailId = randomUUID();
  const notificationMessageId = `<legacy-notification-${randomUUID()}@pixlsports.com>`;
  const sentNotification = {
    message_id: notificationMessageId,
    from: "Pixl Sports Support <support@pixlsports.com>",
    to: [replyEmail],
    reply_to: [legacySupportAddress],
    subject: `Update on Pixl Sports support ticket ${ticket.reference}`,
  };
  let lookedUpMessageIds: string[] = [];
  const server = createTestServer(
    secret,
    async (requestedId) => ({
      id: requestedId,
      from: replyEmail,
      to: [legacySupportAddress],
      text: "Here is the information you asked for.",
      headers: { "in-reply-to": notificationMessageId },
      authentication: { spf: "pass", dkim: "pass", dmarc: "pass" },
      message_id: `<legacy-reply-${inboundEmailId}@example.com>`,
    }),
    undefined,
    async (messageIds) => {
      lookedUpMessageIds = messageIds;
      return [sentNotification];
    },
  );

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const body = createWebhookPayload(inboundEmailId);
    const headers = signWebhook(secret, body);
    const post = () => fetch(`http://127.0.0.1:${address.port}/api/support/tickets/email-replies/resend`, {
      method: "POST",
      headers,
      body,
    });

    const first = await post();
    assert.equal(first.status, 200);
    assert.deepEqual(lookedUpMessageIds, [notificationMessageId.slice(1, -1).toLowerCase()]);
    assert.deepEqual(await first.json(), { ok: true, imported: true });
    const duplicate = await post();
    assert.equal(duplicate.status, 200);
    assert.deepEqual(await duplicate.json(), { ok: true, imported: false });

    const messages = await db.select().from(supportTicketMessagesTable)
      .where(eq(supportTicketMessagesTable.ticketId, ticket.id));
    assert.equal(messages.length, 1);
    assert.equal(messages[0].body, "Here is the information you asked for.");
    assert.equal(messages[0].emailProviderMessageId, inboundEmailId);
    assert.equal(messages[0].emailMessageId, `legacy-reply-${inboundEmailId}@example.com`.toLowerCase());
  } finally {
    await closeServer(server);
    await deleteTicket(ticket.id);
  }
});

test("legacy thread evidence matching multiple tickets is rejected as ambiguous", async () => {
  const secret = `whsec_${randomBytes(32).toString("base64")}`;
  const [firstTicket, secondTicket] = await Promise.all([createTicket(), createTicket()]);
  const inboundEmailId = randomUUID();
  const firstMessageId = `<legacy-first-${randomUUID()}@pixlsports.com>`;
  const secondMessageId = `<legacy-second-${randomUUID()}@pixlsports.com>`;
  const server = createTestServer(
    secret,
    async (requestedId) => ({
      id: requestedId,
      from: replyEmail,
      to: [legacySupportAddress],
      text: "This reply includes conflicting thread history.",
      headers: { references: `${firstMessageId} ${secondMessageId}` },
      authentication: { spf: "pass", dkim: "pass", dmarc: "pass" },
    }),
    undefined,
    async () => [
      {
        message_id: firstMessageId,
        from: "support@pixlsports.com",
        to: [replyEmail],
        reply_to: [legacySupportAddress],
        subject: `Update on Pixl Sports support ticket ${firstTicket.ticket.reference}`,
      },
      {
        message_id: secondMessageId,
        from: "support@pixlsports.com",
        to: [replyEmail],
        reply_to: [legacySupportAddress],
        subject: `Update on Pixl Sports support ticket ${secondTicket.ticket.reference}`,
      },
    ],
  );

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const body = createWebhookPayload(inboundEmailId);
    const response = await fetch(`http://127.0.0.1:${address.port}/api/support/tickets/email-replies/resend`, {
      method: "POST",
      headers: signWebhook(secret, body),
      body,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, ignored: true });
    const imported = await db.select().from(supportTicketMessagesTable)
      .where(eq(supportTicketMessagesTable.emailProviderMessageId, inboundEmailId));
    assert.equal(imported.length, 0);
  } finally {
    await closeServer(server);
    await deleteTicket(firstTicket.ticket.id);
    await deleteTicket(secondTicket.ticket.id);
  }
});

test("legacy replies are rejected without authenticated sender and exact thread evidence", async () => {
  const secret = `whsec_${randomBytes(32).toString("base64")}`;
  const { ticket } = await createTicket();
  const notificationMessageId = `<old-${randomUUID()}@pixlsports.com>`;
  const emailIds = [randomUUID(), randomUUID()];
  const messages = new Map<string, unknown>([
    [emailIds[0], {
      id: emailIds[0],
      from: replyEmail,
      to: [legacySupportAddress],
      text: "A subject and reference are not enough.",
      authentication: { spf: "pass", dkim: "pass", dmarc: "pass" },
    }],
    [emailIds[1], {
      id: emailIds[1],
      from: replyEmail,
      to: [legacySupportAddress],
      text: "A forged sender should not be imported.",
      headers: { "in-reply-to": notificationMessageId },
      authentication: { spf: "fail", dkim: "fail", dmarc: "fail" },
    }],
  ]);
  let lookupCount = 0;
  const server = createTestServer(
    secret,
    async (emailId) => messages.get(emailId),
    undefined,
    async () => {
      lookupCount += 1;
      return [{
        message_id: notificationMessageId,
        from: "support@pixlsports.com",
        to: [replyEmail],
        subject: `Update on Pixl Sports support ticket ${ticket.reference}`,
      }];
    },
  );

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    for (const emailId of emailIds) {
      const body = createWebhookPayload(emailId);
      const response: globalThis.Response = await fetch(`http://127.0.0.1:${address.port}/api/support/tickets/email-replies/resend`, {
        method: "POST",
        headers: signWebhook(secret, body),
        body,
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, ignored: true });
    }

    assert.equal(lookupCount, 0);
    const imported = await db.select().from(supportTicketMessagesTable)
      .where(eq(supportTicketMessagesTable.ticketId, ticket.id));
    assert.equal(imported.length, 0);
  } finally {
    await closeServer(server);
    await deleteTicket(ticket.id);
  }
});

test("unsigned webhook requests are rejected before the email body is fetched", async () => {
  const secret = `whsec_${randomBytes(32).toString("base64")}`;
  let fetchCount = 0;
  const server = createTestServer(secret, async () => {
    fetchCount += 1;
    return {};
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const body = createWebhookPayload(randomUUID());
    const response = await fetch(`http://127.0.0.1:${address.port}/api/support/tickets/email-replies/resend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Invalid Resend webhook signature." });
    assert.equal(fetchCount, 0);
  } finally {
    await closeServer(server);
  }
});

test("HTML-only inbound email is converted to bounded plain text", () => {
  assert.equal(formatReceivedSupportEmailBody({ html: "<p>Hello&nbsp;there.</p>" }), "Hello there.");
  const longBody = formatReceivedSupportEmailBody({ text: "x".repeat(7000) });
  assert.equal(Array.from(longBody ?? "").length, 5000);
  assert.ok(longBody?.endsWith("[Email reply shortened to fit the support thread.]"));
  assert.equal(
    getSupportTicketReplyToken(buildSupportTicketReplyAddress("a".repeat(56), replyDomain), replyDomain),
    "a".repeat(56),
  );
});

test("admin email replies use a unique reply address that is stored only as a hash", async () => {
  const { ticket } = await createTicket();
  let delivered: { reference: string; replyEmail: string; body: string; replyTo?: string } | undefined;
  const server = createTestServer(
    `whsec_${randomBytes(32).toString("base64")}`,
    async () => ({}),
    async (message) => {
      delivered = message;
      return { messageId: `<sent-${ticket.id}@pixlsports.com>` };
    },
  );

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/admin/support/tickets/${ticket.id}/replies`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "Please try the update and let us know." }),
      },
    );
    assert.equal(response.status, 201);
    assert.ok(delivered?.replyTo);
    assert.equal(delivered?.replyEmail, replyEmail);
    const token = getSupportTicketReplyToken(delivered!.replyTo!, replyDomain);
    assert.ok(token);

    const storedTokens = await db.select().from(supportTicketEmailReplyTokensTable)
      .where(eq(supportTicketEmailReplyTokensTable.ticketId, ticket.id));
    assert.equal(storedTokens.length, 1);
    assert.equal(storedTokens[0].tokenHash, hashSupportTicketReplyToken(token!));
    assert.notEqual(storedTokens[0].tokenHash, token);
    const sentMessages = await db.select().from(supportTicketMessagesTable)
      .where(eq(supportTicketMessagesTable.ticketId, ticket.id));
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].emailMessageId, `sent-${ticket.id}@pixlsports.com`);
  } finally {
    await closeServer(server);
    await deleteTicket(ticket.id);
  }
});

test("supported reply attachments are stored privately and exposed only through authorized ticket routes", async (t) => {
  const secret = `whsec_${randomBytes(32).toString("base64")}`;
  const { ticket, accessToken } = await createTicket();
  const replyToken = randomBytes(28).toString("hex");
  const emailId = randomUUID();
  const attachmentId = randomUUID();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
  await db.insert(supportTicketEmailReplyTokensTable).values({
    ticketId: ticket.id,
    tokenHash: hashSupportTicketReplyToken(replyToken),
  });
  const metadata = {
    id: attachmentId,
    filename: "../family-photo.png",
    content_type: "image/png",
    size: png.length,
    download_url: "https://inbound-cdn.resend.com/signed-file",
  };
  const server = createTestServer(secret, async (requestedId) => ({
    id: requestedId,
    from: replyEmail,
    to: [buildSupportTicketReplyAddress(replyToken, replyDomain)],
    text: "Here is the screenshot.",
    authentication: { spf: "pass", dkim: "pass", dmarc: "pass" },
  }), undefined, undefined, {
    listAttachments: async () => ({ items: [metadata], hasMore: false }),
    downloadAttachment: async (_requestedEmailId, requestedAttachmentId, url) => {
      assert.equal(requestedAttachmentId, attachmentId);
      assert.equal(url, metadata.download_url);
      return png;
    },
    saveAttachment: async (contents, contentType) => {
      assert.deepEqual(contents, png);
      assert.equal(contentType, "image/png");
      return `/objects/support-ticket-attachments/${randomUUID()}`;
    },
  });

  const getMetadata = t.mock.method(ObjectStorageService.prototype, "getObjectEntityMetadata", async () => ({
    size: png.length,
    contentType: "image/png",
  }));
  const getFile = t.mock.method(ObjectStorageService.prototype, "getObjectEntityFile", async () =>
    ({} as Awaited<ReturnType<ObjectStorageService["getObjectEntityFile"]>>)
  );
  const download = t.mock.method(ObjectStorageService.prototype, "downloadObject", async () =>
    new Response(png, { headers: { "Content-Type": "image/png" } })
  );

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const body = createWebhookPayload(emailId);
    const webhookResponse = await fetch(`http://127.0.0.1:${address.port}/api/support/tickets/email-replies/resend`, {
      method: "POST",
      headers: signWebhook(secret, body),
      body,
    });
    assert.equal(webhookResponse.status, 200);
    assert.deepEqual(await webhookResponse.json(), { ok: true, imported: true });

    const rows = await db.select().from(supportTicketMessageAttachmentsTable)
      .where(eq(supportTicketMessageAttachmentsTable.providerAttachmentId, attachmentId));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "available");
    assert.equal(rows[0].filename, "_family-photo.png");
    assert.equal(rows[0].objectPath?.startsWith("/objects/support-ticket-attachments/"), true);

    const detailResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/support/tickets/${ticket.id}`,
      { headers: { "x-support-ticket-token": accessToken } },
    );
    const detail = await detailResponse.json() as {
      messages: Array<{ id: string; attachments: Array<Record<string, unknown>> }>;
    };
    assert.equal(detailResponse.status, 200);
    const message = detail.messages[0];
    const attachment = message.attachments[0];
    assert.equal(attachment.filename, "_family-photo.png");
    assert.equal(attachment.status, "available");
    assert.equal("objectPath" in attachment, false);
    assert.equal("providerAttachmentId" in attachment, false);
    const downloadUrl = attachment.downloadUrl as string;
    assert.ok(downloadUrl.startsWith(`/api/support/tickets/${ticket.id}/messages/${message.id}/attachments/`));

    const denied = await fetch(`http://127.0.0.1:${address.port}${downloadUrl}`, {
      headers: { "x-support-ticket-token": randomBytes(32).toString("base64url") },
    });
    assert.equal(denied.status, 404);
    const memberDownload = await fetch(`http://127.0.0.1:${address.port}${downloadUrl}`, {
      headers: { "x-support-ticket-token": accessToken },
    });
    assert.equal(memberDownload.status, 200);
    assert.equal(memberDownload.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await memberDownload.arrayBuffer()), png);

    const adminDownload = await fetch(
      `http://127.0.0.1:${address.port}/api/admin/support/tickets/${ticket.id}/messages/${message.id}/attachments/${attachment.id}`,
    );
    assert.equal(adminDownload.status, 200);
    assert.equal(getMetadata.mock.callCount(), 2);
    assert.equal(getFile.mock.callCount(), 2);
    assert.equal(download.mock.callCount(), 2);
  } finally {
    await closeServer(server);
    await deleteTicket(ticket.id);
  }
});

test("unsupported, oversized, unavailable, and excess attachments do not block an attachment-only reply", async () => {
  const secret = `whsec_${randomBytes(32).toString("base64")}`;
  const { ticket } = await createTicket();
  const replyToken = randomBytes(28).toString("hex");
  const emailId = randomUUID();
  const attachmentMetadata = [
    {
      id: randomUUID(),
      filename: "script.svg",
      content_type: "image/svg+xml",
      size: 100,
      download_url: "https://inbound-cdn.resend.com/script",
    },
    {
      id: randomUUID(),
      filename: "large.png",
      content_type: "image/png",
      size: 5 * 1024 * 1024 + 1,
      download_url: "https://inbound-cdn.resend.com/large",
    },
    {
      id: randomUUID(),
      filename: "failed.jpg",
      content_type: "image/jpeg",
      size: 120,
      download_url: "https://inbound-cdn.resend.com/failed",
    },
    ...Array.from({ length: 3 }, (_, index) => ({
      id: randomUUID(),
      filename: `other-${index}.exe`,
      content_type: "application/x-test",
      size: 1,
      download_url: `https://inbound-cdn.resend.com/other-${index}`,
    })),
  ];
  await db.insert(supportTicketEmailReplyTokensTable).values({
    ticketId: ticket.id,
    tokenHash: hashSupportTicketReplyToken(replyToken),
  });
  const server = createTestServer(secret, async (requestedId) => ({
    id: requestedId,
    from: replyEmail,
    to: [buildSupportTicketReplyAddress(replyToken, replyDomain)],
    text: "",
    authentication: { spf: "pass", dkim: "pass", dmarc: "pass" },
  }), undefined, undefined, {
    listAttachments: async () => ({ items: attachmentMetadata, hasMore: true }),
    downloadAttachment: async (_requestedEmailId, attachmentId) => {
      assert.equal(attachmentId, attachmentMetadata[2].id);
      throw new Error("temporary download failure");
    },
    saveAttachment: async () => {
      throw new Error("Rejected files must not be stored");
    },
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const body = createWebhookPayload(emailId);
    const response = await fetch(`http://127.0.0.1:${address.port}/api/support/tickets/email-replies/resend`, {
      method: "POST",
      headers: signWebhook(secret, body),
      body,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, imported: true });
    const [message] = await db.select().from(supportTicketMessagesTable)
      .where(eq(supportTicketMessagesTable.ticketId, ticket.id));
    assert.equal(message.body, "Customer sent attachments without a message.");

    const attachments = await db.select().from(supportTicketMessageAttachmentsTable)
      .where(eq(supportTicketMessageAttachmentsTable.messageId, message.id));
    assert.deepEqual(attachments.map((attachment) => attachment.status), [
      "unsupported",
      "too_large",
      "unavailable",
      "unsupported",
      "unsupported",
      "too_many",
    ]);
    assert.ok(attachments.every((attachment) => attachment.objectPath === null));
  } finally {
    await closeServer(server);
    await deleteTicket(ticket.id);
  }
});
