import { connect } from "node:http2";
import { importPKCS8, SignJWT } from "jose";

export type ApnsEnvironment = "sandbox" | "production";

export type ApnsConfig = {
  available: boolean;
  keyId: string | null;
  teamId: string | null;
  topic: string | null;
  privateKey: string | null;
};

export type ApnsSendResult = {
  configured: boolean;
  sent: boolean;
  stale: boolean;
  failure?: "temporary" | "permanent" | "uncertain";
};

type ReminderPushPayload = {
  title?: unknown;
  body?: unknown;
  url?: unknown;
  tag?: unknown;
};

type NativePushTarget = {
  deviceToken: string;
  environment: string;
};

const APNS_TOKEN_TTL_MS = 50 * 60 * 1000;
const TOKEN_HEX_PATTERN = /^[a-f0-9]{64,512}$/i;

let cachedToken: { value: string; expiresAt: number; cacheKey: string } | null = null;

export function getApnsConfig(environment: NodeJS.ProcessEnv = process.env): ApnsConfig {
  const privateKey = environment.APNS_AUTH_KEY?.replace(/\\n/g, "\n").trim() || null;
  const keyId = environment.APNS_KEY_ID?.trim() || null;
  const teamId = environment.APNS_TEAM_ID?.trim() || null;
  const topic = environment.APNS_TOPIC?.trim() || null;
  return {
    available: Boolean(privateKey && keyId && teamId && topic),
    keyId,
    teamId,
    topic,
    privateKey,
  };
}

export function getApnsAuthority(environment: ApnsEnvironment) {
  return environment === "sandbox"
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";
}

function normalizePayload(payload: ReminderPushPayload) {
  const title = typeof payload.title === "string" ? payload.title : "PIXL Sports";
  const body = typeof payload.body === "string" ? payload.body : "Open PIXL Sports to view your Event Card.";
  const url = typeof payload.url === "string" ? payload.url : "/studio";
  const tag = typeof payload.tag === "string" ? payload.tag : undefined;
  return {
    aps: {
      alert: { title, body },
      sound: "default",
      ...(tag ? { "thread-id": tag } : {}),
    },
    url,
  };
}

async function getProviderToken(config: ApnsConfig) {
  if (!config.available || !config.privateKey || !config.keyId || !config.teamId) return null;
  const cacheKey = `${config.keyId}:${config.teamId}:${config.privateKey.length}`;
  const now = Date.now();
  if (cachedToken?.cacheKey === cacheKey && cachedToken.expiresAt > now) return cachedToken.value;

  const key = await importPKCS8(config.privateKey, "ES256");
  const value = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: config.keyId })
    .setIssuer(config.teamId)
    .setIssuedAt()
    .sign(key);
  cachedToken = { value, expiresAt: now + APNS_TOKEN_TTL_MS, cacheKey };
  return value;
}

export async function sendApnsPush(
  target: NativePushTarget,
  payload: ReminderPushPayload,
  timeoutMs: number,
  config = getApnsConfig(),
): Promise<ApnsSendResult> {
  if (!config.available || !config.topic || !TOKEN_HEX_PATTERN.test(target.deviceToken)) {
    return { configured: false, sent: false, stale: false, failure: "temporary" };
  }

  if (target.environment !== "sandbox" && target.environment !== "production") {
    return { configured: true, sent: false, stale: false, failure: "permanent" };
  }

  let providerToken: string;
  try {
    const token = await getProviderToken(config);
    if (!token) return { configured: false, sent: false, stale: false, failure: "temporary" };
    providerToken = token;
  } catch {
    return { configured: true, sent: false, stale: false, failure: "temporary" };
  }

  const authority = getApnsAuthority(target.environment);
  return new Promise((resolve) => {
    let settled = false;
    let responseStatus = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let session: ReturnType<typeof connect> | undefined;
    let stream: ReturnType<ReturnType<typeof connect>["request"]> | undefined;

    const finish = (result: ApnsSendResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      stream?.close();
      session?.close();
      resolve(result);
    };

    try {
      session = connect(authority);
      stream = session.request({
        ":method": "POST",
        ":path": `/3/device/${target.deviceToken}`,
        authorization: `bearer ${providerToken}`,
        "apns-topic": config.topic!,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
      });
      timer = setTimeout(() => {
        finish({ configured: true, sent: false, stale: false, failure: "uncertain" });
      }, timeoutMs);
      timer.unref?.();

      stream.on("response", (headers) => {
        responseStatus = Number(headers[":status"] ?? 0);
      });
      stream.on("end", () => {
        if (responseStatus === 200) {
          finish({ configured: true, sent: true, stale: false });
        } else if (responseStatus === 410) {
          finish({ configured: true, sent: false, stale: true });
        } else if (responseStatus === 429 || responseStatus >= 500 || responseStatus === 403) {
          finish({ configured: true, sent: false, stale: false, failure: "temporary" });
        } else if (responseStatus > 0) {
          finish({ configured: true, sent: false, stale: false, failure: "permanent" });
        } else {
          finish({ configured: true, sent: false, stale: false, failure: "uncertain" });
        }
      });
      stream.on("error", () => {
        finish({ configured: true, sent: false, stale: false, failure: "uncertain" });
      });
      session.on("error", () => {
        finish({ configured: true, sent: false, stale: false, failure: "uncertain" });
      });
      stream.end(JSON.stringify(normalizePayload(payload)));
    } catch {
      finish({ configured: true, sent: false, stale: false, failure: "uncertain" });
    }
  });
}
