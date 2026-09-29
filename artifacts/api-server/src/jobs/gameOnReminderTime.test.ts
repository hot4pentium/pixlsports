import assert from "node:assert/strict";
import test from "node:test";
import { localInstant, scheduledGameOnTimes } from "./gameOnReminderTime";

test("event-local one-hour and day-of reminders retain their UTC instants across DST", () => {
  const before = scheduledGameOnTimes({
    id: "match", type: "game", date: "2026-03-07", time: "12:00 PM",
    timezone: "America/New_York",
  }, "America/New_York", { oneHourBefore: true, dayOf: true });
  const after = scheduledGameOnTimes({
    id: "match", type: "game", date: "2026-03-08", time: "12:00 PM",
    timezone: "America/New_York",
  }, "America/New_York", { oneHourBefore: true, dayOf: true });
  assert.equal(before.find((item) => item.type === "one_hour")?.dueAt.toISOString(), "2026-03-07T16:00:00.000Z");
  assert.equal(after.find((item) => item.type === "one_hour")?.dueAt.toISOString(), "2026-03-08T15:00:00.000Z");
  assert.equal(after.find((item) => item.type === "day_of")?.dueAt.toISOString(), "2026-03-08T11:00:00.000Z");
});

test("nonexistent spring DST times are rejected; repeated fall times choose the first occurrence", () => {
  assert.equal(localInstant("2026-03-08", "02:30", "America/New_York"), null);
  assert.equal(localInstant("2026-11-01", "01:30", "America/New_York")?.toISOString(), "2026-11-01T05:30:00.000Z");
  assert.equal(localInstant("2026-02-30", "12:00", "America/New_York"), null);
  assert.equal(localInstant("2026-07-01", "25:00", "America/New_York"), null);
});

test("day-of date-only reminders expire on the next local day", () => {
  const reminders = scheduledGameOnTimes({
    id: "practice", type: "practice", date: "2026-10-04", time: "",
  }, "America/Los_Angeles", { oneHourBefore: true, dayOf: true });
  assert.deepEqual(reminders.map((item) => item.type), ["day_of"]);
  assert.equal(reminders[0]?.dueAt.toISOString(), "2026-10-04T14:00:00.000Z");
  assert.equal(reminders[0]?.expiresAt.toISOString(), "2026-10-05T07:00:00.000Z");
});

test("one-hour alerts follow the event zone while day-of alerts follow the account's chosen zone", () => {
  const reminders = scheduledGameOnTimes({
    id: "match",
    type: "game",
    date: "2026-03-08",
    time: "12:00",
    timezone: "America/New_York",
  }, "America/Los_Angeles", { oneHourBefore: true, dayOf: true });

  assert.equal(reminders.find((item) => item.type === "one_hour")?.dueAt.toISOString(), "2026-03-08T15:00:00.000Z");
  assert.equal(reminders.find((item) => item.type === "day_of")?.dueAt.toISOString(), "2026-03-08T14:00:00.000Z");
});