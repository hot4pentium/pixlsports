import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { createNativeSupporterEventCard, loadNativeSupporterSchedule } from "./nativeSupporterSchedule";
import type { NativeIdentity } from "./nativeIdentity";
import { GAME_ON_CARD_MARKER } from "./gameOnCard";

const owners: string[] = [];
const subjects: string[] = [];

function identity(): NativeIdentity {
  const subject = `user_nativeEvent${randomUUID().replaceAll("-", "")}`;
  subjects.push(subject);
  return { issuer: "https://native-event-fixture.clerk.accounts.dev", subject };
}

async function owner() {
  const ownerClerkUserId = `user_webEvent${randomUUID().replaceAll("-", "")}`;
  owners.push(ownerClerkUserId);
  await pool.query(`INSERT INTO account_access (owner_clerk_user_id,role,access_mode,lifecycle_status)
    VALUES ($1,'fan','free','active')`, [ownerClerkUserId]);
  return ownerClerkUserId;
}

async function link(who: NativeIdentity, ownerClerkUserId: string) {
  await pool.query(`INSERT INTO native_account_links
    (native_issuer,native_subject,owner_clerk_user_id,account_label)
    VALUES ($1,$2,$3,'Native Event Card test account')`,
  [who.issuer, who.subject, ownerClerkUserId]);
}

after(async () => {
  await pool.query("DELETE FROM schedule_shares WHERE owner_clerk_user_id=ANY($1::text[])", [owners]);
  await pool.query("DELETE FROM athlete_invites WHERE owner_clerk_user_id=ANY($1::text[])", [owners]);
  await pool.query("DELETE FROM native_account_links WHERE native_subject=ANY($1::text[])", [subjects]);
  await pool.query("DELETE FROM account_access WHERE owner_clerk_user_id=ANY($1::text[])", [owners]);
  await pool.end();
});

test("native Event Card creation is account-scoped, redacts prep fields, and safely retries", async () => {
  const who = identity();
  const linkedOwner = await owner();
  await link(who, linkedOwner);
  await pool.query(`INSERT INTO athlete_invites
    (owner_clerk_user_id,public_token,athlete_name,team_name,season_name,season_ends_at,sport,timezone)
    VALUES ($1,$2,'Jordan','Tigers','Spring 2099','2099-06-01T00:00:00Z','soccer','America/New_York')`,
  [linkedOwner, `native-event-${randomUUID()}`]);

  const draft = {
    eventId: randomUUID(),
    type: "game" as const,
    date: "2099-04-01",
    time: "18:00",
    timezone: "America/Chicago",
    location: "Field 2",
    opponent: "Bears",
  };
  const first = await createNativeSupporterEventCard(who, draft);
  const retry = await createNativeSupporterEventCard(who, draft);

  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.equal(retry.shareToken, first.shareToken);
  assert.equal(first.share.teamSeason, GAME_ON_CARD_MARKER);
  const savedEvent = (first.share.events as Array<Record<string, unknown>>)[0];
  assert.equal(savedEvent?.id, draft.eventId);
  assert.equal(savedEvent?.status, "upcoming");
  assert.equal(savedEvent?.timezone, "America/Chicago");
  assert.equal(savedEvent?.notes, "");
  assert.equal(savedEvent?.snacks, "");
  assert.equal(savedEvent?.drinks, "");

  const schedule = await loadNativeSupporterSchedule(who);
  assert.equal(schedule.events.length, 1);
  assert.equal(schedule.events[0]?.eventId, draft.eventId);
  assert.equal(schedule.events[0]?.shareToken, first.shareToken);
});

test("native Event Card creation rejects an unlinked iPhone identity", async () => {
  const who = identity();
  await assert.rejects(
    createNativeSupporterEventCard(who, {
      eventId: randomUUID(),
      type: "practice",
      date: "2099-04-01",
      time: "18:00",
      timezone: "America/New_York",
      location: "",
      opponent: "",
    }),
    (error: unknown) => Boolean(error && typeof error === "object" && "status" in error && error.status === 409),
  );
});
