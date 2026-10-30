import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { loadNativeSupporterSchedule } from "./nativeSupporterSchedule";
import type { NativeIdentity } from "./nativeIdentity";
import { GAME_ON_CARD_MARKER } from "./gameOnCard";

const owners: string[] = [];
const nativeSubjects: string[] = [];
const errorStatus = (status: number) => (error: any) => error.status === status;

function identity(): NativeIdentity {
  const subject = `user_nativeSchedule${randomUUID().replaceAll("-", "")}`;
  nativeSubjects.push(subject);
  return { issuer: "https://native-schedule-fixture.clerk.accounts.dev", subject };
}

async function owner(status = "active") {
  const ownerClerkUserId = `user_webSchedule${randomUUID().replaceAll("-", "")}`;
  owners.push(ownerClerkUserId);
  await pool.query(`INSERT INTO account_access (owner_clerk_user_id,role,access_mode,lifecycle_status)
    VALUES ($1,'fan','free',$2)`, [ownerClerkUserId, status]);
  return ownerClerkUserId;
}

async function link(who: NativeIdentity, ownerClerkUserId: string) {
  await pool.query(`INSERT INTO native_account_links
    (native_issuer,native_subject,owner_clerk_user_id,account_label)
    VALUES ($1,$2,$3,'Schedule test account')`,
  [who.issuer, who.subject, ownerClerkUserId]);
}

after(async () => {
  await pool.query("DELETE FROM schedule_shares WHERE owner_clerk_user_id=ANY($1::text[])", [owners]);
  await pool.query("DELETE FROM athlete_invites WHERE owner_clerk_user_id=ANY($1::text[])", [owners]);
  await pool.query("DELETE FROM native_account_links WHERE native_subject=ANY($1::text[])", [nativeSubjects]);
  await pool.query("DELETE FROM account_access WHERE owner_clerk_user_id=ANY($1::text[])", [owners]);
  await pool.end();
});

test("native schedule is scoped to the explicitly linked active account", async () => {
  const who = identity();
  const linkedOwner = await owner();
  const otherOwner = await owner();
  await link(who, linkedOwner);

  await pool.query(`INSERT INTO athlete_invites
    (owner_clerk_user_id,public_token,athlete_name,team_name,season_name,season_ends_at,sport,timezone)
    VALUES ($1,$2,'Jordan','Tigers','Spring 2099','2099-06-01T00:00:00Z','soccer','America/New_York')`,
  [linkedOwner, randomBytes(18).toString("base64url")]);

  const insertSchedule = (ownerClerkUserId: string, eventId: string, title: string) =>
    pool.query(`INSERT INTO schedule_shares (owner_clerk_user_id,title,team_season,events)
      VALUES ($1,$2,$3,$4::jsonb)`,
    [ownerClerkUserId, title, GAME_ON_CARD_MARKER, JSON.stringify([{
      id: eventId,
      date: "2099-04-01",
      time: "18:00",
      type: "game",
      opponent: "Bears",
      location: "Field 2",
      timezone: "America/Chicago",
      notes: "private prep",
      snacks: "private snacks",
    }])]);

  await insertSchedule(linkedOwner, "linked-game", "Tigers vs Bears");
  await insertSchedule(otherOwner, "other-game", "Private opponent");

  const schedule = await loadNativeSupporterSchedule(who);
  assert.equal(schedule.status, "linked");
  assert.equal(schedule.athleteName, "Jordan");
  assert.equal(schedule.events.length, 1);
  assert.equal(schedule.events[0]?.eventId, "linked-game");
  assert.equal(schedule.events[0]?.title, "Tigers vs Bears");
  assert.equal(schedule.events[0]?.date, "2099-04-01");
  assert.equal(schedule.events[0]?.time, "18:00");
  assert.equal(schedule.events[0]?.opponent, "Bears");
  assert.equal(schedule.events[0]?.location, "Field 2");
  assert.equal(schedule.events[0]?.timezone, "America/Chicago");
  assert.equal(JSON.stringify(schedule).includes("Private opponent"), false);
  assert.equal(JSON.stringify(schedule).includes("private prep"), false);
  assert.equal(JSON.stringify(schedule).includes("private snacks"), false);
});

test("unlinked native identities receive no account schedule", async () => {
  const schedule = await loadNativeSupporterSchedule(identity());
  assert.deepEqual(schedule, {
    status: "unlinked",
    athleteName: null,
    teamName: null,
    seasonName: null,
    timezone: null,
    events: [],
  });
});

test("paused PIXL accounts cannot read their linked private schedule", async () => {
  const who = identity();
  const pausedOwner = await owner("paused");
  await link(who, pausedOwner);

  await assert.rejects(loadNativeSupporterSchedule(who), errorStatus(423));
});
