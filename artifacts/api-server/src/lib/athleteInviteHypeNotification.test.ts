import assert from "node:assert/strict";
import test from "node:test";
import { notifyAthleteInviteHypeOwner } from "./athleteInviteHypeNotification";

test("fan Shoutout alerts notify the owner privately and open the owner Shoutouts section", async () => {
  let delivered: { ownerId: string; payload: unknown } | undefined;
  await notifyAthleteInviteHypeOwner({
    id: "invite-id",
    ownerClerkUserId: "owner-id",
    publicToken: "token/with spaces",
    athleteName: "Taylor Athlete",
  }, "hype-id", async (ownerId, payload) => {
    delivered = { ownerId, payload };
    return { configured: true, sent: 1, removed: 0 };
  });

  assert.deepEqual(delivered, {
    ownerId: "owner-id",
    payload: {
      title: "New fan Shoutout for Taylor Athlete",
      body: "A fan sent a shoutout. Tap to read it.",
      url: "/player/token%2Fwith%20spaces/manage#owner-fan-hypes",
      tag: "athlete-invite-hype-hype-id",
    },
  });
  assert.doesNotMatch(JSON.stringify(delivered?.payload), /message|private fan text/i);
});