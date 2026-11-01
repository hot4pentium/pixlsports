import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import {
  createNativeSupporterEventCard,
  loadNativeSupporterSchedule,
  updateNativeSupporterEventCard,
} from "./nativeSupporterSchedule";
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
  const [first, retry] = await Promise.all([
    createNativeSupporterEventCard(who, draft),
    createNativeSupporterEventCard(who, draft),
  ]);

  assert.notEqual(first.created, retry.created, "concurrent retries create only one card");
  assert.equal(retry.shareToken, first.shareToken);
  assert.equal(first.share.title, "Tigers");
  assert.equal(first.share.teamSeason, GAME_ON_CARD_MARKER);
  const savedEvent = (first.share.events as Array<Record<string, unknown>>)[0];
  assert.equal(savedEvent?.id, draft.eventId);
  assert.equal(savedEvent?.status, "upcoming");
  assert.equal(savedEvent?.timezone, "America/Chicago");
  assert.equal(savedEvent?.notes, "");
  assert.equal(savedEvent?.snacks, "");
  assert.equal(savedEvent?.drinks, "");

  await pool.query(`UPDATE schedule_shares
    SET events=jsonb_set(events, '{0}', events->0 || $1::jsonb)
    WHERE id=$2`, [JSON.stringify({
    status: "live",
    snacks: "Fruit",
    drinks: "Water",
    notes: "Bring cleats",
  }), first.shareToken]);

  const updatedDraft = {
    ...draft,
    type: "practice" as const,
    date: "2099-04-02",
    time: "19:15",
    timezone: "America/Denver",
    location: "Field 4",
    opponent: "",
  };
  const updated = await updateNativeSupporterEventCard(who, first.shareToken, updatedDraft);
  const updateRetry = await updateNativeSupporterEventCard(who, first.shareToken, updatedDraft);
  assert.equal(updated.shareToken, first.shareToken);
  assert.equal(updateRetry.shareToken, first.shareToken);
  const updatedEvent = (updateRetry.share.events as Array<Record<string, unknown>>)[0];
  assert.equal(updatedEvent?.type, "practice");
  assert.equal(updatedEvent?.date, "2099-04-02");
  assert.equal(updatedEvent?.time, "19:15");
  assert.equal(updatedEvent?.timezone, "America/Denver");
  assert.equal(updatedEvent?.location, "Field 4");
  assert.equal(updatedEvent?.opponent, "");
  assert.equal(updatedEvent?.status, "live");
  assert.equal(updatedEvent?.snacks, "Fruit");
  assert.equal(updatedEvent?.drinks, "Water");
  assert.equal(updatedEvent?.notes, "Bring cleats");

  await pool.query("UPDATE account_access SET lifecycle_status='paused' WHERE owner_clerk_user_id=$1", [linkedOwner]);
  await assert.rejects(
    updateNativeSupporterEventCard(who, first.shareToken, updatedDraft),
    (error: unknown) => Boolean(error && typeof error === "object" && "status" in error && error.status === 423),
  );
  await pool.query("UPDATE account_access SET lifecycle_status='active' WHERE owner_clerk_user_id=$1", [linkedOwner]);

  const otherOwner = await owner();
  const foreignEventId = randomUUID();
  const { rows: foreignRows } = await pool.query<{ id: string }>(`INSERT INTO schedule_shares
    (owner_clerk_user_id,title,team_season,events)
    VALUES ($1,'Other team',$2,$3::jsonb) RETURNING id::text AS id`,
  [otherOwner, GAME_ON_CARD_MARKER, JSON.stringify([{
    id: foreignEventId, type: "game", status: "upcoming", date: "2099-04-01", time: "18:00",
    timezone: "America/Chicago", location: "Other field", opponent: "Other team",
  }])]);
  await assert.rejects(
    updateNativeSupporterEventCard(who, foreignRows[0]!.id, { ...draft, eventId: foreignEventId }),
    (error: unknown) => Boolean(error && typeof error === "object" && "status" in error && error.status === 404),
  );

  const schedule = await loadNativeSupporterSchedule(who);
  assert.equal(schedule.events.length, 1);
  assert.equal(schedule.events[0]?.eventId, draft.eventId);
  assert.equal(schedule.events[0]?.shareToken, first.shareToken);
  assert.equal(schedule.events[0]?.type, "practice");
  assert.equal(schedule.events[0]?.date, "2099-04-02");
});

test("native Event Card creation works without a team and keeps the season label", async () => {
  const who = identity();
  const linkedOwner = await owner();
  await link(who, linkedOwner);
  await pool.query(`INSERT INTO athlete_invites
    (owner_clerk_user_id,public_token,athlete_name,team_name,season_name,season_ends_at,sport,timezone)
    VALUES ($1,$2,'Jordan','', 'Spring 2099','2099-06-01T00:00:00Z','soccer','America/New_York')`,
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
  const created = await createNativeSupporterEventCard(who, draft);

  assert.equal(created.created, true);
  assert.equal(created.share.title, "Jordan · Spring 2099");
  assert.equal(created.share.teamSeason, GAME_ON_CARD_MARKER);
  const event = (created.share.events as Array<Record<string, unknown>>)[0];
  assert.equal(event?.id, draft.eventId);
  assert.equal(event?.opponent, "Bears");
  const schedule = await loadNativeSupporterSchedule(who);
  assert.equal(schedule.status, "linked");
  assert.equal(schedule.athleteName, "Jordan");
  assert.equal(schedule.teamName, "");
  assert.equal(schedule.seasonName, "Spring 2099");
  assert.equal(schedule.events.length, 1);
  assert.equal(schedule.events[0]?.shareToken, created.shareToken);
  assert.equal(schedule.events[0]?.title, "Jordan · Spring 2099");
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
