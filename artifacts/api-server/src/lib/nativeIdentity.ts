import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export class NativeLinkError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type NativeIdentity = { issuer: string; subject: string };

export function nativeIssuer(raw = process.env.NATIVE_IOS_CLERK_ISSUER): string {
  if (!raw) throw new NativeLinkError(503, "iPhone account linking has not been configured.");
  let url: URL;
  try { url = new URL(raw); } catch {
    throw new NativeLinkError(503, "iPhone account linking has not been configured.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
    || url.pathname !== "/" || url.port) {
    throw new NativeLinkError(503, "The iPhone sign-in issuer configuration is invalid.");
  }
  return url.origin;
}

export function nativeLinkWebOrigin(): string {
  const origin = process.env.NATIVE_LINK_WEB_ORIGIN
    ?? (process.env.NODE_ENV !== "production" && process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "https://pixlsports.com");
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin) {
    throw new NativeLinkError(503, "The account-link website configuration is invalid.");
  }
  return url.origin;
}

const resolvers = new Map<string, JWTVerifyGetKey>();
export async function verifyNativeIdentity(
  token: string,
  issuer = nativeIssuer(),
  key?: JWTVerifyGetKey,
): Promise<NativeIdentity> {
  // The issuer/key URL comes ONLY from server configuration, never unverified
  // JWT iss/jku/x5u claims, a client key, a query parameter, or the PWA session.
  let resolver = key ?? resolvers.get(issuer);
  if (!resolver) {
    resolver = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
      timeoutDuration: 5000, cooldownDuration: 30000,
    });
    resolvers.set(issuer, resolver);
  }
  try {
    const { payload } = await jwtVerify(token, resolver, {
      issuer, algorithms: ["RS256"], maxTokenAge: "5 minutes", clockTolerance: 5,
      requiredClaims: ["sub", "sid", "exp", "iat"],
    });
    if (typeof payload.sub !== "string" || !/^user_[A-Za-z0-9]+$/.test(payload.sub)
      || typeof payload.sid !== "string" || !/^sess_[A-Za-z0-9]+$/.test(payload.sid)
      || typeof payload.exp !== "number" || typeof payload.iat !== "number"
      || payload.exp <= payload.iat || payload.exp - payload.iat > 300
      || (payload.sts !== undefined && payload.sts !== "active")) {
      throw new Error("Not an active Clerk session token");
    }
    return { issuer, subject: payload.sub };
  } catch {
    throw new NativeLinkError(401, "Sign in to the iPhone app again.");
  }
}
