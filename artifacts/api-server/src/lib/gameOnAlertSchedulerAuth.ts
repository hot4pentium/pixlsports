import { createHmac, timingSafeEqual } from "node:crypto";

export const GAME_ON_ALERTS_TRIGGER_PATH = "/api/internal/jobs/game-on-alerts";
export const GAME_ON_ALERTS_TRIGGER_SECRET_MIN_LENGTH = 32;
export const GAME_ON_ALERTS_TRIGGER_MAX_CLOCK_SKEW_MS = 90_000;

export type GameOnAlertSignatureInput = {
  timestamp: string;
  nonce: string;
  signature: string;
};

function signingPayload(timestamp: string, nonce: string) {
  return ["v1", "POST", GAME_ON_ALERTS_TRIGGER_PATH, timestamp, nonce].join("\n");
}

export function createGameOnAlertSignature(secret: string, timestamp: string, nonce: string) {
  return createHmac("sha256", secret)
    .update(signingPayload(timestamp, nonce))
    .digest("hex");
}

export function isValidGameOnAlertSignature(
  input: GameOnAlertSignatureInput,
  secret: string,
  nowMs = Date.now(),
) {
  if (secret.length < GAME_ON_ALERTS_TRIGGER_SECRET_MIN_LENGTH) return false;
  if (!/^\d{13}$/.test(input.timestamp)) return false;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.nonce)) return false;
  if (!/^[0-9a-f]{64}$/i.test(input.signature)) return false;

  const timestampMs = Number(input.timestamp);
  if (!Number.isSafeInteger(timestampMs)
    || Math.abs(nowMs - timestampMs) > GAME_ON_ALERTS_TRIGGER_MAX_CLOCK_SKEW_MS) return false;

  const expected = Buffer.from(createGameOnAlertSignature(secret, input.timestamp, input.nonce), "hex");
  const actual = Buffer.from(input.signature, "hex");
  return timingSafeEqual(expected, actual);
}