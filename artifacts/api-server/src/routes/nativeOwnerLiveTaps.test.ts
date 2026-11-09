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
import { hasNativeStarterPrivacyPause, nativeStarterPauseFingerprint } from "../lib/nativeStarterPrivacyPause";

// Observe actual PostgreSQL lock dependencies, not elapsed time or request
// launch order. The deadline only bounds a failed test; it never orders writes.
async function waitForBlockedQuery(blocker: number, queryFragment: string): Promise<number> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query<{ pid: number }>(
      `SELECT pid FROM pg_stat_activity
       WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))
         AND position($2 IN query)>0`,
      [blocker, queryFragment],
    );
    if (rows[0]) return rows[0].pid;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`No blocked ${queryFragment} query observed behind backend ${blocker}`);
}

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
  for (const legacy of [false, true]) {
    for (const pauseFirst of [true, false]) {
      await t.test(`${legacy ? "legacy untouched" : "marked"} starter: ${pauseFirst ? "pause" : "cheer"} commits first`, async () => {
        // Restore only this test owner's starter provenance. Legacy starters
        // have no marker and rely on equal timestamps, not an explicit pause.
        await pool.query(
          `UPDATE native_accounts SET profile_metadata=$2::jsonb WHERE owner_id=$1`,
          [owner, JSON.stringify({
            ...metadata,
            nativeStarterPrivatePause: legacy ? undefined : nativeStarterPauseFingerprint(token),
          })],
        );
        await pool.query(
          "UPDATE athlete_invites SET paused=true,updated_at=created_at WHERE public_token=$1", [token],
        );
        assert.equal(await hasNativeStarterPrivacyPause(owner, token), true);
        const start = await request(livePath, "POST", { eventId, soccerPeriodFormat: "halves" });
        assert.ok([200, 201].includes(start.status), await start.text());
        // Starting safely upgrades legacy provenance. Restore a historical
        // untouched live row to exercise fallback during the cheer itself.
        if (legacy) {
          assert.equal(await hasNativeStarterPrivacyPause(owner, token), true);
          await pool.query(
            "UPDATE native_accounts SET profile_metadata=profile_metadata-'nativeStarterPrivatePause' WHERE owner_id=$1",
            [owner],
          );
          await pool.query("UPDATE athlete_invites SET updated_at=created_at WHERE public_token=$1", [token]);
        }
        const currentSummary = await request(summaryPath);
        assert.equal(currentSummary.status, 200);
        const { liveTaps } = await currentSummary.json() as typeof summary;
        const savedCheer = {
          cheerKey: liveTaps.cheers[0]!.key, gameId: liveTaps.gameId,
          clientMutationId: randomUUID(), expectedEventId: eventId,
        };
        const earlierCheer = { ...savedCheer, clientMutationId: randomUUID() };
        const acknowledged = await request(summaryPath, "POST", earlierCheer);
        assert.equal(acknowledged.status, 201);
        const earlierReceipt = (await acknowledged.json()).receipt;
        assert.equal(earlierReceipt.id, earlierCheer.clientMutationId);
        if (legacy) await pool.query(
          "UPDATE athlete_invites SET updated_at=created_at WHERE public_token=$1", [token],
        );
        const current = await loadNativeSupporterHypeCard({ issuer, subject });
        assert.ok(current.settings);
        const { revision, ...values } = current.settings;
        const pauseBody = { ...values, paused: true, expectedRevision: revision, confirmPublish: false };
        const state = async () => (await pool.query(
          `SELECT ai.paused,ai.live_tracker_share_token AS pointer,
                  na.profile_metadata ? 'nativeStarterPrivatePause' AS has_marker,
                  na.profile_metadata->'nativeStarterPrivatePause' AS marker
           FROM athlete_invites ai JOIN native_accounts na ON na.owner_id=ai.owner_clerk_user_id
           WHERE ai.public_token=$1`, [token],
        )).rows[0];
        const before = await state();
        assert.ok(before.pointer);
        assert.equal(before.has_marker, !legacy);
        const countGame = async () => Number((await pool.query(
          `SELECT count(*) AS total FROM athlete_invite_live_taps
           WHERE invite_id=(SELECT id FROM athlete_invites WHERE public_token=$1) AND game_id=$2`,
          [token, savedCheer.gameId],
        )).rows[0].total);
        const beforeCount = await countGame();
        const gate = await pool.connect();
        let pause: Promise<Response> | undefined;
        let cheerInFlight: Promise<Response> | undefined;
        try {
          await gate.query("BEGIN");
          const gatePid = (await gate.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
          await gate.query("SELECT id FROM stat_tracker_shares WHERE id=$1 FOR UPDATE", [before.pointer]);
          if (pauseFirst) {
            pause = request("/native/supporter/hype-card", "PATCH", pauseBody);
            // Pause has already written the tombstone and cleared the pointer
            // inside its transaction, but cannot commit until share deletion.
            const pausePid = await waitForBlockedQuery(gatePid, "DELETE FROM stat_tracker_shares");
            cheerInFlight = request(summaryPath, "POST", savedCheer);
            await waitForBlockedQuery(pausePid, 'for update');
          } else {
            cheerInFlight = request(summaryPath, "POST", savedCheer);
            const cheerPid = await waitForBlockedQuery(gatePid, '"stat_tracker_shares"');
            pause = request("/native/supporter/hype-card", "PATCH", pauseBody);
            await waitForBlockedQuery(cheerPid, "FOR UPDATE");
          }
          assert.deepEqual(await state(), before,
            "other connections must see the complete pre-pause state until commit");
          assert.equal(await hasNativeStarterPrivacyPause(owner, token), true);
          await gate.query("COMMIT");
          const [paused, cheered] = await Promise.all([pause, cheerInFlight]);
          assert.equal(paused.status, 200, await paused.text());
          assert.equal(cheered.status, pauseFirst ? 404 : 201, await cheered.text());
        } finally {
          await gate.query("ROLLBACK");
          gate.release();
          await Promise.allSettled([pause, cheerInFlight].filter(Boolean));
        }
        assert.deepEqual(await state(), { paused: true, pointer: null, has_marker: true, marker: null },
          "explicit settings must commit the tombstone and cleared live pointer together");
        assert.equal(await hasNativeStarterPrivacyPause(owner, token), false);
        assert.equal((await pool.query("SELECT id FROM stat_tracker_shares WHERE id=$1", [before.pointer])).rowCount, 0);
        const finalCount = beforeCount + (pauseFirst ? 0 : 1);
        assert.equal(await countGame(), finalCount);
        // Privacy wins even over receipt retries. A refusal never removes an
        // earlier receipt or turns a saved pending cheer into a delivered one.
        for (const body of [earlierCheer, savedCheer, { ...savedCheer, clientMutationId: randomUUID() }]) {
          assert.equal((await request(summaryPath, "POST", body)).status, 404);
        }
        assert.equal((await request(summaryPath)).status, 403);
        assert.equal((await request(livePath, "POST", { eventId, soccerPeriodFormat: "halves" })).status, 403);
        assert.equal(await countGame(), finalCount);
        assert.equal((await pool.query(
          "SELECT count(*)::int AS total FROM athlete_invite_live_taps WHERE id=$1",
          [earlierCheer.clientMutationId],
        )).rows[0].total, 1);

        // Even equal timestamps cannot resurrect legacy fallback after an
        // explicit saved pause: the JSON null is a deliberate tombstone.
        await pool.query("UPDATE athlete_invites SET updated_at=created_at WHERE public_token=$1", [token]);
        assert.equal(await hasNativeStarterPrivacyPause(owner, token), false);
        assert.equal((await request(summaryPath, "POST", savedCheer)).status, 404);

        // A later event cannot absorb the same locally saved game/event IDs.
        await setPause(false);
        const nextEventId = randomUUID();
        await pool.query(
          "UPDATE schedule_shares SET events=events || $2::jsonb WHERE id=$1",
          [shareId, JSON.stringify([{
            id: nextEventId, type: "game", status: "scheduled", date: now.toISOString().slice(0, 10),
            time: now.toISOString().slice(11, 16), timezone: "UTC", opponent: "Owls",
          }])],
        );
        const nextStart = await request(livePath, "POST", { eventId: nextEventId, soccerPeriodFormat: "halves" });
        assert.ok([200, 201].includes(nextStart.status), await nextStart.text());
        const nextSummaryResponse = await request(summaryPath);
        const nextSummary = await nextSummaryResponse.json() as typeof summary;
        assert.notEqual(nextSummary.liveTaps.gameId, savedCheer.gameId);
        const retried = await request(summaryPath, "POST", savedCheer);
        assert.equal(retried.status, pauseFirst ? 409 : 201);
        if (!pauseFirst) {
          assert.equal((await retried.json()).receipt.gameId, savedCheer.gameId);
        }
        const wrongEvent = { ...savedCheer, gameId: nextSummary.liveTaps.gameId, clientMutationId: randomUUID() };
        assert.equal((await request(summaryPath, "POST", wrongEvent)).status, 409);
        assert.equal((await pool.query(
          `SELECT count(*)::int AS total FROM athlete_invite_live_taps
           WHERE invite_id=(SELECT id FROM athlete_invites WHERE public_token=$1) AND game_id=$2`,
          [token, nextSummary.liveTaps.gameId],
        )).rows[0].total, 0);
        assert.equal(await countGame(), finalCount);
        await setPause(true);
        await pool.query(
          `UPDATE schedule_shares SET events=(
             SELECT jsonb_agg(event) FROM jsonb_array_elements(events) event WHERE event->>'id'=$2
           ) WHERE id=$1`,
          [shareId, eventId],
        );
      });
    }
  }
  // A separate explicit settings action may enable fan access without
  // publishing the HYPE Card itself. Startup must never perform it.
  await setPause(false);
  const resumed = await request(livePath, "POST", { eventId, soccerPeriodFormat: "halves" });
  assert.ok([200, 201].includes(resumed.status), await resumed.text());
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
