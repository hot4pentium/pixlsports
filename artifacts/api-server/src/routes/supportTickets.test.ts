import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";
import express from "express";
import { inArray } from "drizzle-orm";
import { CreateSupportTicketResponse } from "@workspace/api-zod";
import { db, supportTicketsTable } from "@workspace/db";
import {
  generateSupportTicketReference,
  MAX_SUPPORT_TICKET_REFERENCE_ATTEMPTS,
} from "../lib/supportTicketReference";
import { createSupportTicketsRouter } from "./supportTickets";

const ticketInput = {
  replyEmail: "ticket-reference-test@example.com",
  issueId: "feedback",
  description: "Testing support ticket reference creation.",
  deviceType: "desktop",
  connectionType: "wifi",
};

function createTestServer(createReference: () => string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const auth = () => ({ userId: undefined, tokenType: "session_token" });
    (auth as any)[Symbol.for("@clerk/express.auth")] = true;
    (req as any).auth = auth;
    (req as any).log = { error: () => undefined };
    next();
  });
  app.use("/api", createSupportTicketsRouter({ createReference }));
  return app.listen(0);
}

async function closeServer(server: ReturnType<typeof createTestServer>) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function readJson(response: Response) {
  return response.json() as Promise<Record<string, any>>;
}

async function seedTicket(reference: string) {
  const [ticket] = await db.insert(supportTicketsTable).values({
    reference,
    ownerClerkUserId: null,
    accessTokenHash: createHash("sha256").update(randomBytes(32)).digest("hex"),
    replyEmail: "existing-reference-test@example.com",
    issueId: "other",
    description: "Existing ticket used by reference tests.",
    deviceType: "desktop",
    connectionType: "wifi",
  }).returning();
  return ticket;
}

test("ticket creation retries a reference collision and keeps existing references unchanged", async () => {
  const collisionReference = generateSupportTicketReference();
  const newReference = generateSupportTicketReference();
  const legacyReference = `PS-20261011-${randomBytes(3).toString("hex").toUpperCase()}`;
  assert.notEqual(collisionReference, newReference);
  const testReferences = [collisionReference, newReference, legacyReference];
  let referenceIndex = 0;
  const server = createTestServer(() => {
    const reference = [collisionReference, newReference][referenceIndex];
    referenceIndex += 1;
    if (!reference) throw new Error("Unexpected additional support ticket reference attempt.");
    return reference;
  });

  try {
    const oldTicket = await seedTicket(collisionReference);
    const legacyTicket = await seedTicket(legacyReference);
    const address = server.address();
    assert.ok(address && typeof address === "object");

    const createdResponse = await fetch(`http://127.0.0.1:${address.port}/api/support/tickets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ticketInput),
    });
    assert.equal(createdResponse.status, 201);
    const created = CreateSupportTicketResponse.parse(await createdResponse.json());
    assert.equal(created.ticket.reference, newReference);
    assert.equal(created.ticket.reference.length, 11);

    const detailResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/support/tickets/${created.ticket.id}`,
      { headers: { "x-support-ticket-token": created.accessToken } },
    );
    assert.equal(detailResponse.status, 200);
    assert.equal((await readJson(detailResponse)).reference, newReference);

    const oldRecords = await db.select().from(supportTicketsTable)
      .where(inArray(supportTicketsTable.reference, [collisionReference, legacyReference]));
    assert.deepEqual(
      oldRecords.map(({ id, reference }) => ({ id, reference })).sort((a, b) => a.reference.localeCompare(b.reference)),
      [
        { id: oldTicket.id, reference: collisionReference },
        { id: legacyTicket.id, reference: legacyReference },
      ].sort((a, b) => a.reference.localeCompare(b.reference)),
    );
    assert.equal(referenceIndex, 2);
  } finally {
    await closeServer(server);
    await db.delete(supportTicketsTable).where(inArray(supportTicketsTable.reference, testReferences));
  }
});

test("ticket creation returns a retryable 503 after all reference attempts collide", async () => {
  const collisionReference = generateSupportTicketReference();
  let referenceAttempts = 0;
  const server = createTestServer(() => {
    referenceAttempts += 1;
    return collisionReference;
  });

  try {
    await seedTicket(collisionReference);
    const address = server.address();
    assert.ok(address && typeof address === "object");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/support/tickets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ticketInput),
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await readJson(response), {
      error: "Your ticket could not be created right now. Please try again.",
    });
    assert.equal(referenceAttempts, MAX_SUPPORT_TICKET_REFERENCE_ATTEMPTS);

    const existingRows = await db.select().from(supportTicketsTable)
      .where(inArray(supportTicketsTable.reference, [collisionReference]));
    assert.equal(existingRows.length, 1);
  } finally {
    await closeServer(server);
    await db.delete(supportTicketsTable).where(inArray(supportTicketsTable.reference, [collisionReference]));
  }
});
