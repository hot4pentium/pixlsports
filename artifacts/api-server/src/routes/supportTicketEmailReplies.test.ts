import assert from "node:assert/strict";
import { createHmac, createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import express, { type Request } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  supportTicketEmailReplyTokensTable,
  supportTicketMessagesTable,
  supportTicketsTable,
} from "@workspace/db";
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
const adminUserId = "support-reply-test-admin";

function createTestServer(
  webhookSecret: string,
  fetchReceivedEmail: (emailId: string) => Promise<unknown>,
  onAdminReply?: (message: { reference: string; replyEmail: string; body: string; replyTo?: string }) => Promise<void>,
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
    }],
    [emailIds[1], {
      id: emailIds[1],
      from: replyEmail,
      to: [buildSupportTicketReplyAddress(unknownToken, replyDomain)],
      text: "This should not be imported either.",
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
  } finally {
    await closeServer(server);
    await deleteTicket(ticket.id);
  }
});
