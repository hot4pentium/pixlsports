import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import express from "express";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { pool } from "@workspace/db";
import athleteInvitesRouter from "./athleteInvites";
import athleteLiveTapsRouter from "./athleteLiveTaps";
import { nativeAccountLinkRouter } from "./nativeAccountLink";
import { GAME_ON_CARD_MARKER } from "../lib/gameOnCard";
import { assignNativeStarterCard } from "../lib/nativeStarterHypeCard";
import { loadNativeSupporterHypeCard, updateNativeSupporterHypeCard } from "../lib/nativeSupporterHypeCard";

test("verified native owner starts, reads and cheers on a private starter before creating a matching fan QR", async (t) => {
  const issuer = `https://native-taps-${randomUUID()}.clerk.accounts.dev`;
  const owner = `pixl-ios:${randomBytes(32).toString("hex")}`;
  const other = `native-taps-other-${randomUUID()}`;
  const subject = `user_${randomUUID().replaceAll("-", "")}`;
  const otherSubject = `user_${randomUUID().replaceAll("-", "")}`;
  let token = "";
  const eventId = randomUUID();
  const shareId = randomUUID();
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const kid = "native-private-taps";
  const oldIssuer = process.env.NATIVE_IOS_CLERK_ISSUER;
  const oldFetch = globalThis.fetch;
  process.env.NATIVE_IOS_CLERK_ISSUER = issuer;
  globalThis.fetch = async (input, init) => String(input) === `${issuer}/.well-known/jwks.json`
    ? Response.json({ keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] }) : oldFetch(input, init);
  t.after(() => {
    globalThis.fetch = oldFetch;
    if (oldIssuer === undefined) delete process.env.NATIVE_IOS_CLERK_ISSUER;
    else process.env.NATIVE_IOS_CLERK_ISSUER = oldIssuer;
  });
  const bearer = async (who: string) => `Bearer ${await new SignJWT({ sid: `sess_${randomUUID().replaceAll("-", "")}` })
    .setProtectedHeader({ alg: "RS256", kid }).setIssuer(issuer).setSubject(who)
    .setIssuedAt().setExpirationTime("5m").sign(privateKey)}`;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // Model the signed-out web middleware. The native JWT still goes through
    // real signature verification and the database's explicit account link.
    const auth = () => ({ userId: undefined, tokenType: "session_token" });
    Object.assign(auth, { [Symbol.for("@clerk/express.auth")]: true });
    (req as express.Request & { auth: typeof auth }).auth = auth;
    next();
  });
  app.use("/api/native", nativeAccountLinkRouter);
  app.use("/api", athleteInvitesRouter, athleteLiveTapsRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/api`;
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.query("DELETE FROM athlete_invites WHERE owner_clerk_user_id=ANY($1::text[])", [[owner, other]]);
    await pool.query("DELETE FROM stat_tracker_shares WHERE owner_clerk_user_id=ANY($1::text[])", [[owner, other]]);
    await pool.query("DELETE FROM schedule_shares WHERE id=$1", [shareId]);
    await pool.query("DELETE FROM cloud_projects WHERE owner_clerk_user_id=ANY($1::text[])", [[owner, other]]);
    await pool.query("DELETE FROM native_account_links WHERE native_issuer=$1", [issuer]);
    await pool.query("DELETE FROM native_accounts WHERE owner_id=$1", [owner]);
    await pool.query("DELETE FROM account_access WHERE owner_clerk_user_id=ANY($1::text[])", [[owner, other]]);
    await pool.end();
  });
  await pool.query(`INSERT INTO account_access(owner_clerk_user_id,role,access_mode,lifecycle_status)
    VALUES ($1,'fan','full','active'),($2,'fan','full','active')`, [owner, other]);
  await pool.query(`INSERT INTO native_account_links(native_issuer,native_subject,owner_clerk_user_id,account_label)
    VALUES ($1,$2,$3,'Owner'),($1,$4,$5,'Other')`, [issuer, subject, owner, otherSubject, other]);
  await pool.query(`INSERT INTO native_accounts(owner_id,native_issuer,native_subject)
    VALUES ($1,$2,$3)`, [owner, issuer, subject]);
  const metadata: Record<string, unknown> = {
    athleteName: "Jordan", teamName: "Tigers", sport: "soccer", timezone: "UTC", seasonName: "Test season",
  };
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const starter = await assignNativeStarterCard(tx, owner, { athleteName: "Jordan", teamName: "Tigers", sport: "soccer" }, metadata);
    token = starter.public_token;
    await tx.query("UPDATE native_accounts SET profile_metadata=$2::jsonb WHERE owner_id=$1", [owner, JSON.stringify(metadata)]);
    await tx.query("COMMIT");
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally { tx.release(); }
  const now = new Date();
  await pool.query(`INSERT INTO schedule_shares(id,owner_clerk_user_id,title,team_season,events)
    VALUES ($1,$2,'Test game',$3,$4::jsonb)`, [shareId, owner, GAME_ON_CARD_MARKER, JSON.stringify([{
    id: eventId, type: "game", status: "scheduled", date: now.toISOString().slice(0, 10),
    time: now.toISOString().slice(11, 16), timezone: "UTC", opponent: "Bears", location: "Test field",
  }])]);
  const request = async (path: string, method = "GET", body?: unknown, who = subject) => fetch(`${base}${path}`, {
    method, headers: { authorization: await bearer(who), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const livePath = `/athlete-invites/${token}/live`;
  const summaryPath = `/athlete-invites/${token}/live-taps`;
  const contextResponse = await request("/native/supporter/hype-card");
  assert.equal(contextResponse.status, 200);
  const context = await contextResponse.json() as { status: string; inviteToken?: string; ownerLiveTaps: { status: string; ownerOnly: boolean } };
  assert.equal(context.status, "hidden");
  assert.equal(context.inviteToken, undefined);
  assert.equal(context.ownerLiveTaps.status, "ready");
  assert.equal(context.ownerLiveTaps.ownerOnly, true);
  assert.equal((await fetch(`${base}/athlete-invites/${token}/fan`)).status, 404);
  const anonymous = await fetch(`${base}${summaryPath}`);
  assert.equal(anonymous.status, 401);
  assert.equal((await request(summaryPath, "GET", undefined, otherSubject)).status, 404);
  const started = await request(livePath, "POST", { eventId, soccerPeriodFormat: "halves" });
  assert.ok([200, 201].includes(started.status), await started.text());
  const response = await request(summaryPath);
  assert.equal(response.status, 200);
  const summary = await response.json() as { sport: string; liveTaps: { active: boolean; gameId: string; cheers: { key: string }[] } };
  assert.equal(summary.sport, "soccer");
  assert.equal(summary.liveTaps.active, true);
  assert.ok(summary.liveTaps.gameId);
  assert.ok(summary.liveTaps.cheers[0]?.key);
  const cheer = await request(summaryPath, "POST", {
    cheerKey: summary.liveTaps.cheers[0]!.key, gameId: summary.liveTaps.gameId,
    clientMutationId: randomUUID(), expectedEventId: eventId,
  });
  assert.equal(cheer.status, 201, await cheer.text());
  const scheduleResponse = await request("/native/supporter/schedule");
  assert.equal(scheduleResponse.status, 200);
  const schedule = await scheduleResponse.json() as { events: { eventId: string; liveTapsActive: boolean }[] };
  assert.ok(schedule.events.some((event) => event.eventId === eventId && event.liveTapsActive));
  assert.equal((await request("/native/supporter/live-taps-access", "POST", { action: "create", shareToken: shareId })).status, 403);
  const privateSettings = (await pool.query(
    "SELECT show_hype_card,show_stats,show_events,paused FROM athlete_invites WHERE public_token=$1", [token],
  )).rows[0];
  assert.deepEqual(privateSettings, { show_hype_card: false, show_stats: false, show_events: false, paused: true });
  assert.equal((await fetch(`${base}/athlete-invites/${token}/fan`)).status, 404,
    "private owner cheers must not unpause or publish the starter");
  const setPause = async (paused: boolean) => {
    const current = await loadNativeSupporterHypeCard({ issuer, subject });
    assert.ok(current.settings);
    const { revision, ...values } = current.settings;
    await updateNativeSupporterHypeCard({ issuer, subject }, {
      ...values, paused, expectedRevision: revision, confirmPublish: false,
    });
  };
  // A separate explicit settings action may enable fan access without
  // publishing the HYPE Card itself. Startup must never perform it.
  await setPause(false);
  const qr = await request("/native/supporter/live-taps-access", "POST", { action: "create", shareToken: shareId });
  assert.ok([200, 201].includes(qr.status), await qr.text());
  const settings = (await pool.query("SELECT show_hype_card,paused FROM athlete_invites WHERE public_token=$1", [token])).rows[0];
  assert.deepEqual(settings, { show_hype_card: false, paused: false });
  await setPause(true);
  assert.equal((await request(summaryPath)).status, 403);
  assert.equal((await request(livePath, "POST", { eventId, soccerPeriodFormat: "halves" })).status, 403);
  await pool.query("UPDATE athlete_invites SET paused=false,season_ends_at=NOW()-INTERVAL '1 day' WHERE public_token=$1", [token]);
  assert.equal((await request(summaryPath)).status, 410);
  assert.equal((await request(livePath, "POST", { eventId, soccerPeriodFormat: "halves" })).status, 410);
  assert.equal((await request(summaryPath, "POST", {
    cheerKey: summary.liveTaps.cheers[0]!.key, gameId: summary.liveTaps.gameId,
    clientMutationId: randomUUID(), expectedEventId: eventId,
  })).status, 410);
});
