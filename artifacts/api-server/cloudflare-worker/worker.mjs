const TRIGGER_PATH = "/api/internal/jobs/game-on-alerts";
const MIN_SECRET_LENGTH = 32;
const REQUEST_TIMEOUT_MS = 60_000;
const encoder = new TextEncoder();

function configuration(env) {
  const secret = env?.GAME_ON_ALERTS_TRIGGER_SECRET;
  const endpointValue = env?.GAME_ON_ALERTS_TRIGGER_URL;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error("Game On trigger secret is not configured.");
  }
  if (!endpointValue) {
    throw new Error("Game On trigger URL is not configured.");
  }

  let endpoint;
  try {
    endpoint = new URL(endpointValue);
  } catch {
    throw new Error("Game On trigger URL must be a published HTTPS endpoint.");
  }

  const hostname = endpoint.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (endpoint.protocol !== "https:"
    || endpoint.username
    || endpoint.password
    || endpoint.search
    || endpoint.hash
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname === "replit.dev"
    || hostname.endsWith(".replit.dev")
    || /^[\d.]+$/.test(hostname)
    || hostname.includes(":")
    || endpoint.pathname !== TRIGGER_PATH) {
    throw new Error("Game On trigger URL must be a published HTTPS endpoint.");
  }

  return { endpoint, secret };
}

async function sign(secret, timestamp, nonce) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const payload = ["v1", "POST", TRIGGER_PATH, timestamp, nonce].join("\n");
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function runGameOnAlertTrigger(env, options = {}) {
  const { endpoint, secret } = configuration(env);
  const timestamp = String((options.now ?? Date.now)());
  const nonce = (options.nonce ?? (() => crypto.randomUUID()))();
  const signature = await sign(secret, timestamp, nonce);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        "x-game-on-alerts-timestamp": timestamp,
        "x-game-on-alerts-nonce": nonce,
        "x-game-on-alerts-signature": signature,
      },
      signal: controller.signal,
    });
    await response.body?.cancel();
    if (!response.ok) {
      throw new Error(`Game On reminder trigger returned HTTP ${response.status}.`);
    }
    console.info(`Game On reminder trigger completed (HTTP ${response.status}).`);
  } finally {
    clearTimeout(timeout);
  }
}

export default {
  async scheduled(_controller, env) {
    await runGameOnAlertTrigger(env);
  },
};