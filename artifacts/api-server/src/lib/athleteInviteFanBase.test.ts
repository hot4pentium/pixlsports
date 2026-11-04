import assert from "node:assert/strict";
import test from "node:test";
import { summarizeFanBase } from "./athleteInviteFanBase";

test("Fan Base counts saved device follows and only includes volunteered names", () => {
  assert.deepEqual(summarizeFanBase([
    { displayName: "  Sam  " },
    { displayName: null },
    { displayName: "   " },
    { displayName: "Jordan" },
  ]), {
    totalFollows: 4,
    namedFans: ["Sam", "Jordan"],
    anonymousFollows: 2,
  });
});
