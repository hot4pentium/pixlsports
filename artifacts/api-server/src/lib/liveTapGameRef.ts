import { createHmac } from "node:crypto";

/** Stable, invite-scoped matching key. Never publish an Event Card's raw ID as a session key. */
export function liveTapGameRef(inviteId: string, gameId: string): string {
  return `lt_${createHmac("sha256", inviteId).update(gameId).digest("base64url")}`;
}

export function visibleLiveTapReceipt(
  receipt: { id: string; gameId: string; cheerKey: string }, full: boolean, inviteId: string,
) {
  const gameRef = liveTapGameRef(inviteId, receipt.gameId);
  return { ...receipt, gameId: full ? receipt.gameId : gameRef, gameRef };
}
