import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { logger } from "../lib/logger";
import {
  createGameOnAlertSignature,
  GAME_ON_ALERTS_TRIGGER_PATH,
  GAME_ON_ALERTS_TRIGGER_SECRET_MIN_LENGTH,
} from "../lib/gameOnAlertSchedulerAuth";

const TIMEOUT_MS = 60_000;

function getConfiguration() {
  const endpointValue = process.env["GAME_ON_ALERTS_TRIGGER_URL"];
  const secret = process.env["GAME_ON_ALERTS_TRIGGER_SECRET"];
  if (!endpointValue) throw new Error("GAME_ON_ALERTS_TRIGGER_URL is required.");
  if (!secret || secret.length < GAME_ON_ALERTS_TRIGGER_SECRET_MIN_LENGTH) {
    throw new Error("GAME_ON_ALERTS_TRIGGER_SECRET must be configured with at least 32 characters.");
  }

  let endpoint: URL;
  try {
    endpoint = new URL(endpointValue);
  } catch {
    throw new Error("GAME_ON_ALERTS_TRIGGER_URL must be a valid HTTPS endpoint.");
  }
  const hostname = endpoint.hostname.toLowerCase();
  if (endpoint.protocol !== "https:"
    || endpoint.username
    || endpoint.password
    || endpoint.search
    || endpoint.hash
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".replit.dev")
    || isIP(hostname)
    || !endpoint.pathname.endsWith(GAME_ON_ALERTS_TRIGGER_PATH)) {
    throw new Error("GAME_ON_ALERTS_TRIGGER_URL must be a published HTTPS endpoint for the Game On reminder trigger.");
  }

  return { endpoint, secret };
}

async function main() {
  const { endpoint, secret } = getConfiguration();
  const timestamp = String(Date.now());
  const nonce = randomUUID();
  const signature = createGameOnAlertSignature(secret, timestamp, nonce);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        "x-game-on-alerts-timestamp": timestamp,
        "x-game-on-alerts-nonce": nonce,
        "x-game-on-alerts-signature": signature,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Game On reminder trigger returned HTTP ${response.status}.`);
    }
    logger.info({ statusCode: response.status }, "Game On reminder trigger completed");
  } finally {
    clearTimeout(timeout);
  }
}

void main().catch((error) => {
  logger.error({ err: error }, "Game On reminder trigger failed");
  process.exitCode = 1;
});