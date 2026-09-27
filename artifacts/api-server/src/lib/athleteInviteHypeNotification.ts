import type { PushNotificationPayload } from "./webPush";
import { sendPushNotificationToUser } from "./webPush";

type AthleteInviteHypeNotificationInvite = {
  id: string;
  ownerClerkUserId: string;
  publicToken: string;
  athleteName: string;
};

export function buildAthleteInviteHypeNotification(
  invite: AthleteInviteHypeNotificationInvite,
  hypeId: string,
): PushNotificationPayload {
  return {
    title: `New fan Shoutout for ${invite.athleteName}`,
    body: "A fan sent a shoutout. Tap to read it.",
    url: `/player/${encodeURIComponent(invite.publicToken)}/manage#owner-fan-hypes`,
    tag: `athlete-invite-hype-${hypeId}`,
  };
}

export function notifyAthleteInviteHypeOwner(
  invite: AthleteInviteHypeNotificationInvite,
  hypeId: string,
  send: typeof sendPushNotificationToUser = sendPushNotificationToUser,
) {
  return send(
    invite.ownerClerkUserId,
    buildAthleteInviteHypeNotification(invite, hypeId),
  );
}