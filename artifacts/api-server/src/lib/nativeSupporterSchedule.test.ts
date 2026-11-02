import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { loadNativeSupporterSchedule, updateNativeSupporterEventCard } from "./nativeSupporterSchedule";
import { GetNativeSupporterScheduleResponse } from "@workspace/api-zod";
import { nativeEventWorkspace } from "./nativeEventWorkspace";
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
  await pool.query("DELETE FROM admin_identity_blocks WHERE clerk_user_id=ANY($1::text[])", [owners]);
  await pool.query("DELETE FROM checklist_shares WHERE owner_clerk_user_id=ANY($1::text[])", [owners]);
  await pool.query("DELETE FROM schedule_shares WHERE owner_clerk_user_id=ANY($1::text[])", [owners]);
  await pool.query("DELETE FROM stat_tracker_shares WHERE owner_clerk_user_id=ANY($1::text[])", [owners]);
  await pool.query("DELETE FROM athlete_invites WHERE owner_clerk_user_id=ANY($1::text[])", [owners]);
  await pool.query("DELETE FROM cloud_projects WHERE owner_clerk_user_id=ANY($1::text[])", [owners]);
  await pool.query("DELETE FROM native_account_links WHERE native_subject=ANY($1::text[])", [nativeSubjects]);
  await pool.query("DELETE FROM account_access WHERE owner_clerk_user_id=ANY($1::text[])", [owners]);
  await pool.end();
});

test("native schedule is scoped to the explicitly linked active account", async () => {
  const who = identity();
  const linkedOwner = await owner();
  const otherOwner = await owner();
  await link(who, linkedOwner);

  const inviteToken = randomBytes(18).toString("base64url");
  await pool.query(`INSERT INTO athlete_invites
    (owner_clerk_user_id,public_token,athlete_name,team_name,season_name,season_ends_at,sport,timezone)
    VALUES ($1,$2,'Jordan','Tigers','Spring 2099','2099-06-01T00:00:00Z','soccer','America/New_York')`,
  [linkedOwner, inviteToken]);

  const insertSchedule = async (ownerClerkUserId: string, eventId: string, title: string) => {
    const inserted = await pool.query<{ id: string }>(`INSERT INTO schedule_shares (owner_clerk_user_id,title,team_season,events)
      VALUES ($1,$2,$3,$4::jsonb)
      RETURNING id::text AS id`,
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
    }])])
    return inserted.rows[0]!.id;
  };

  const linkedShareToken = await insertSchedule(linkedOwner, "linked-game", "Tigers vs Bears");
  const otherShareToken = await insertSchedule(otherOwner, "other-game", "Private opponent");
  await pool.query(`INSERT INTO checklist_shares(owner_clerk_user_id,title,items,notes,selected_game)
    VALUES ($1,'Private game prep','[]','private checklist prep',$2::jsonb)`,
  [linkedOwner, JSON.stringify({ id: "linked-game" })]);

  const schedule = await loadNativeSupporterSchedule(who);
  assert.equal(schedule.status, "linked");
  assert.equal(schedule.athleteName, "Jordan");
  assert.equal(schedule.events.length, 1);
  assert.equal(schedule.events[0]?.eventId, "linked-game");
  assert.equal(schedule.events[0]?.shareToken, linkedShareToken);
  assert.equal(schedule.events[0]?.title, "Tigers vs Bears");
  assert.equal(schedule.events[0]?.date, "2099-04-01");
  assert.equal(schedule.events[0]?.time, "18:00");
  assert.equal(schedule.events[0]?.opponent, "Bears");
  assert.equal(schedule.events[0]?.location, "Field 2");
  assert.equal(schedule.events[0]?.timezone, "America/Chicago");
  assert.equal(schedule.events[0]?.liveTapsActive, false);
  assert.equal(schedule.events[0]?.liveTapsInviteToken, null);
  assert.equal(JSON.stringify(schedule).includes("Private opponent"), false);
  assert.equal(JSON.stringify(schedule).includes("private prep"), false);
  assert.equal(JSON.stringify(schedule).includes("private snacks"), false);
  assert.equal(JSON.stringify(schedule).includes("private checklist prep"), false);
  const privatePrep = await nativeEventWorkspace(who, schedule.events[0]!.shareToken);
  assert.equal(privatePrep.prep.notes, "private checklist prep");
  const updated = await updateNativeSupporterEventCard(who, linkedShareToken, {
    eventId: "linked-game",
    type: "game",
    date: "2099-04-02",
    time: "19:15",
    timezone: "America/Denver",
    location: "Field 9",
    opponent: "Updated Bears",
  });
  assert.equal(updated.share.ownerClerkUserId, linkedOwner);
  const stored = await pool.query<{ owner_clerk_user_id: string; events: Array<Record<string, unknown>> }>(
    "SELECT owner_clerk_user_id,events FROM schedule_shares WHERE id=ANY($1::uuid[]) ORDER BY owner_clerk_user_id",
    [[linkedShareToken, otherShareToken]],
  );
  const linkedStored = stored.rows.find((row) => row.owner_clerk_user_id === linkedOwner);
  const otherStored = stored.rows.find((row) => row.owner_clerk_user_id === otherOwner);
  assert.equal(linkedStored?.events[0]?.date, "2099-04-02");
  assert.equal(linkedStored?.events[0]?.location, "Field 9");
  assert.equal(otherStored?.events[0]?.date, "2099-04-01");
  assert.equal(otherStored?.events[0]?.location, "Field 2");
  const otherWho = identity();
  await link(otherWho, otherOwner);
  await assert.rejects(nativeEventWorkspace(otherWho, schedule.events[0]!.shareToken), errorStatus(404));
  await assert.rejects(updateNativeSupporterEventCard(otherWho, linkedShareToken, {
    eventId: "linked-game",
    type: "game",
    date: "2099-04-03",
    time: "20:00",
    timezone: "America/Denver",
    location: "Unauthorized field",
    opponent: "Unauthorized opponent",
  }), errorStatus(404));
});

test("native schedule exposes only the invite for its matching active Live Taps game", async () => {
  const who = identity();
  const linkedOwner = await owner();
  await link(who, linkedOwner);

  const inviteToken = randomBytes(18).toString("base64url");
  const [invite] = (await pool.query<{ id: string }>(`INSERT INTO athlete_invites
    (owner_clerk_user_id,public_token,athlete_name,team_name,season_name,season_ends_at,sport,timezone)
    VALUES ($1,$2,'Jordan','Tigers','Spring 2099','2099-06-01T00:00:00Z','soccer','America/New_York')
    RETURNING id`, [linkedOwner, inviteToken])).rows;
  await pool.query(`INSERT INTO schedule_shares (owner_clerk_user_id,title,team_season,events)
    VALUES ($1,'Tigers vs Bears',$2,$3::jsonb)`,
  [linkedOwner, GAME_ON_CARD_MARKER, JSON.stringify([{
    id: "active-game",
    date: "2099-04-01",
    time: "18:00",
    type: "game",
    opponent: "Bears",
    location: "Field 2",
  }])]);
  await pool.query(`INSERT INTO schedule_shares (owner_clerk_user_id,title,team_season,events)
    VALUES ($1,'Tigers vs Wolves',$2,$3::jsonb)`,
  [linkedOwner, GAME_ON_CARD_MARKER, JSON.stringify([{
    id: "other-game",
    date: "2099-04-08",
    time: "18:00",
    type: "game",
    opponent: "Wolves",
  }])]);
  const [share] = (await pool.query<{ id: string }>(`INSERT INTO stat_tracker_shares
    (owner_clerk_user_id,game_id,athlete_name,team_name,game,expires_at)
    VALUES ($1,'active-game','Jordan','Tigers',$2::jsonb,NOW()+INTERVAL '1 hour')
    RETURNING id`, [linkedOwner, JSON.stringify({ status: "live", sport: "soccer", liveTapsOnly: true })])).rows;
  await pool.query(`UPDATE athlete_invites SET live_tracker_share_token=$2 WHERE id=$1`, [invite!.id, share!.id]);

  const schedule = await loadNativeSupporterSchedule(who);
  const activeEvent = schedule.events.find((event) => event.eventId === "active-game");
  const otherEvent = schedule.events.find((event) => event.eventId === "other-game");
  assert.equal(activeEvent?.liveTapsActive, true);
  assert.equal(activeEvent?.liveTapsOnly, true);
  assert.equal(activeEvent?.liveTapsInviteToken, inviteToken);
  assert.equal(otherEvent?.liveTapsActive, false);
  assert.equal(otherEvent?.liveTapsOnly, false);
  assert.equal(otherEvent?.liveTapsInviteToken, null);

  await pool.query(
    "UPDATE stat_tracker_shares SET game=$2::jsonb WHERE id=$1",
    [share!.id, JSON.stringify({ status: "live", sport: "soccer" })],
  );
  const statsSchedule = await loadNativeSupporterSchedule(who);
  const statsEvent = statsSchedule.events.find((event) => event.eventId === "active-game");
  assert.equal(statsEvent?.liveTapsActive, true);
  assert.equal(statsEvent?.liveTapsOnly, false);
});

test("private season records use the owner's selected history and intentional final results", async () => {
  const who = identity();
  const selectedOwner = await owner();
  const unrelatedOwner = await owner();
  await link(who, selectedOwner);
  const games = [
    { outcome: "win", scoreRecorded: false },
    { outcome: "loss", score: 5, opponentScore: 1, scoreRecorded: true },
    { score: 0, opponentScore: 0, scoreRecorded: true },
    { score: 2, opponentScore: 1, scoreRecorded: true },
    { score: 0, opponentScore: 0, scoreRecorded: false },
    { outcome: "win", status: "live" },
    { outcome: "win", type: "practice" },
    { outcome: "win", liveTapsOnly: true },
    { outcome: "win", sport: "basketball" },
  ].map((game, i) => ({ id: `record-${i}`, sport: "soccer", status: "final", ...game }));
  const insertProject = async (account: string, history: unknown[]) => {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO cloud_projects(owner_clerk_user_id,name,project) VALUES ($1,'Record fixture',$2::jsonb) RETURNING id`,
      [account, JSON.stringify({ tool: "stat-tracker", games: history })],
    );
    return result.rows[0]!.id;
  };
  const selectedProject = await insertProject(selectedOwner, games);
  // A newer same-owner project must not override the explicitly selected one.
  await insertProject(selectedOwner, [{ id: "other-history", sport: "soccer", status: "final", outcome: "win" }]);
  const unrelatedProject = await insertProject(unrelatedOwner, games);
  await pool.query(`INSERT INTO athlete_invites
    (owner_clerk_user_id,public_token,athlete_name,team_name,season_name,season_ends_at,sport,timezone,tracker_project_id,paused,show_stats)
    VALUES ($1,$2,'Jordan','Tigers','Spring 2099','2099-06-01T00:00:00Z','soccer','UTC',$3,true,false)`,
  [selectedOwner, randomBytes(24).toString("base64url"), selectedProject]);
  const schedule = GetNativeSupporterScheduleResponse.parse(await loadNativeSupporterSchedule(who));
  assert.deepEqual(schedule.record, {
    wins: 2, losses: 1, ties: 1, gamesPlayed: 4, sport: "soccer", seasonName: "Spring 2099",
  });
  assert.equal(schedule.events.length, 0, "Completed history does not require current Event Cards.");
  await pool.query("UPDATE athlete_invites SET tracker_project_id=$1 WHERE owner_clerk_user_id=$2", [unrelatedProject, selectedOwner]);
  assert.equal((await loadNativeSupporterSchedule(who)).record?.gamesPlayed, 0, "Never load another account's project.");
  await pool.query("UPDATE athlete_invites SET tracker_project_id=NULL WHERE owner_clerk_user_id=$1", [selectedOwner]);
  const fallback = await loadNativeSupporterSchedule(who);
  assert.equal(fallback.record?.wins, 1, "Use the latest matching history without adding duplicate projects.");
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
    record: null,
  });
});

test("paused PIXL accounts cannot read their linked private schedule", async () => {
  const who = identity();
  const pausedOwner = await owner("paused");
  await link(who, pausedOwner);

  await assert.rejects(loadNativeSupporterSchedule(who), errorStatus(423));
});

test("blocked PIXL owners cannot read or update private schedules through a native link", async () => {
  const who = identity();
  const blockedOwner = await owner();
  await link(who, blockedOwner);
  const shareToken = (await pool.query<{ id: string }>(`INSERT INTO schedule_shares
    (owner_clerk_user_id,title,team_season,events)
    VALUES ($1,'Private Tigers card',$2,$3::jsonb) RETURNING id`,
  [blockedOwner, GAME_ON_CARD_MARKER, JSON.stringify([{
    id: "blocked-game",
    type: "game",
    date: "2099-04-01",
    time: "18:00",
    timezone: "America/New_York",
    location: "Private field",
    opponent: "Private opponent",
  }])])).rows[0]!.id;
  await pool.query(`INSERT INTO admin_identity_blocks(clerk_user_id,blocked_by_clerk_user_id,reason)
    VALUES ($1,$2,'native link release fixture')`, [blockedOwner, `user_admin${randomUUID().replaceAll("-", "")}`]);

  await assert.rejects(loadNativeSupporterSchedule(who), errorStatus(423));
  await assert.rejects(updateNativeSupporterEventCard(who, shareToken, {
    eventId: "blocked-game",
    type: "game",
    date: "2099-04-02",
    time: "19:00",
    timezone: "America/New_York",
    location: "Changed field",
    opponent: "Changed opponent",
  }), errorStatus(423));
  const stored = (await pool.query<{ events: Array<Record<string, unknown>> }>(
    "SELECT events FROM schedule_shares WHERE id=$1", [shareToken],
  )).rows[0]!;
  assert.equal(stored.events[0]?.location, "Private field");
});
