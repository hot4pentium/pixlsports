import assert from "node:assert/strict";
import test from "node:test";
import { CreateAthleteInviteBody, UpdateAthleteInviteBody } from "@workspace/api-zod";

test("softball HYPE Cards can be created and edited without changing the athlete's sport", () => {
  const card = {
    athleteName: "Alex",
    teamName: "Comets",
    seasonName: "Fall season",
    seasonEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
    sport: "softball",
    timezone: "America/New_York",
    trackerProjectId: null,
    scheduleProjectId: null,
    showHypeCard: true,
    showStats: true,
    showSchedule: false,
    paused: true,
  };
  assert.equal(CreateAthleteInviteBody.parse(card).sport, "softball");
  assert.equal(UpdateAthleteInviteBody.parse(card).sport, "softball");
});
