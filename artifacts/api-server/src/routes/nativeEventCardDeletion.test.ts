import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq } from "drizzle-orm";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  accountAccessTable,
  db,
  pool,
  scheduleSharesTable,
  statTrackerSharesTable,
} from "@workspace/db";
import { digest } from "../lib/nativeAccountLink";
import { GAME_ON_CARD_MARKER } from "../lib/gameOnCard";
import { nativeAccountLinkRouter } from "./nativeAccountLink";
import scheduleSharesRouter from "./scheduleShares";

test("native Event Card deletion checks linked ownership and retains tracker history", async (t) => {
  const issuer = `https://native-event-delete-${randomUUID()}.clerk.accounts.dev`;
  const ownerId = `native-delete-owner-${randomUUID()}`;
  const otherOwnerId = `native-delete-other-${randomUUID()}`;
  const ownerSubject = `user_${randomUUID().replaceAll("-", "")}`;
  const otherSubject = `user_${randomUUID().replaceAll("-", "")}`;
  const eventId = randomUUID();
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const kid = "native-event-card-delete";
  const originalIssuer = process.env.NATIVE_IOS_CLERK_ISSUER;
  const originalFetch = globalThis.fetch;
  process.env.NATIVE_IOS_CLERK_ISSUER = issuer;
  globalThis.fetch = async (input, init) => {
    if (String(input) === `${issuer}/.well-known/jwks.json`) {
      return Response.json({ keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] });
    }
    return originalFetch(input, init);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalIssuer === undefined) delete process.env.NATIVE_IOS_CLERK_ISSUER;
    else process.env.NATIVE_IOS_CLERK_ISSUER = originalIssuer;
  });

  const sessionToken = (subject: string) => new SignJWT({ sid: `sess_${subject}` })
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer(issuer)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime("1m")
    .sign(privateKey);

  await db.insert(accountAccessTable).values([
    { ownerClerkUserId: ownerId, role: "fan", accessMode: "full" },
    { ownerClerkUserId: otherOwnerId, role: "fan", accessMode: "full" },
  ]);
  await pool.query(`INSERT INTO native_account_links
    (native_issuer,native_subject,owner_clerk_user_id,account_label)
    VALUES ($1,$2,$3,'Event Card deletion owner'), ($1,$4,$5,'Other account')`,
  [issuer, ownerSubject, ownerId, otherSubject, otherOwnerId]);

  const [share] = await db.insert(scheduleSharesTable).values({
    ownerClerkUserId: ownerId,
    title: "Tigers",
    teamSeason: GAME_ON_CARD_MARKER,
    events: [{
      id: eventId,
      type: "game",
      status: "final",
      date: "2026-10-31",
      time: "18:30",
      timezone: "America/New_York",
      location: "North Field",
      opponent: "Bears",
      snacks: "",
      drinks: "",
      notes: "",
    }],
  }).returning();
  const [tracker] = await db.insert(statTrackerSharesTable).values({
    ownerClerkUserId: ownerId,
    gameId: eventId,
    athleteName: "Jordan Example",
    teamName: "Tigers",
    game: { status: "final", score: 3, opponentScore: 1, stats: { goals: 2 } },
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  }).returning();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error: () => undefined, warn: () => undefined } as unknown as typeof req.log;
    next();
  });
  app.use("/api/native", nativeAccountLinkRouter);
  app.use("/api", scheduleSharesRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const request = async (subject: string) => fetch(
      `${base}/api/native/supporter/event-cards/${share!.id}`,
      {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${await sessionToken(subject)}`,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );

    const wrongOwner = await request(otherSubject);
    assert.equal(wrongOwner.status, 404);
    assert.equal((await db.select().from(scheduleSharesTable)
      .where(eq(scheduleSharesTable.id, share!.id))).length, 1);

    const deleted = await request(ownerSubject);
    assert.equal(deleted.status, 200);
    assert.deepEqual(await deleted.json(), {
      calendarEventDeleted: false,
      calendarEventStatus: "not-linked",
    });
    assert.equal((await db.select().from(scheduleSharesTable)
      .where(eq(scheduleSharesTable.id, share!.id))).length, 0);
    assert.equal((await db.select().from(statTrackerSharesTable)
      .where(eq(statTrackerSharesTable.id, tracker!.id))).length, 1);

    const publicCard = await fetch(`${base}/api/game-on-cards/${share!.id}`);
    assert.equal(publicCard.status, 404);
    assert.equal((await pool.query(
      "SELECT key FROM game_on_reminder_sync WHERE key=$1",
      [`owner:${ownerId}`],
    )).rowCount, 1);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await db.delete(scheduleSharesTable).where(eq(scheduleSharesTable.id, share!.id));
    await db.delete(statTrackerSharesTable).where(eq(statTrackerSharesTable.id, tracker!.id));
    await pool.query("DELETE FROM game_on_reminder_sync WHERE key=$1", [`owner:${ownerId}`]);
    await pool.query("DELETE FROM native_account_links WHERE native_issuer=$1 AND native_subject=ANY($2::text[])", [
      issuer, [ownerSubject, otherSubject],
    ]);
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, ownerId));
    await db.delete(accountAccessTable).where(eq(accountAccessTable.ownerClerkUserId, otherOwnerId));
    for (const subject of [ownerSubject, otherSubject]) {
      await pool.query("DELETE FROM native_link_rate_limits WHERE key=$1", [
        digest(`native-request:${JSON.stringify({ issuer, subject })}`),
      ]);
    }
  }
});
