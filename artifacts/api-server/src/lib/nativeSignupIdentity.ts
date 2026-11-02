import { ReplitConnectors } from "@replit/connectors-sdk";
import { z } from "zod/v4";
import { NativeLinkError, nativeIssuer, type NativeIdentity } from "./nativeIdentity";

const NativeUser = z.object({
  id: z.string(),
  created_at: z.number(),
  banned: z.boolean(),
  locked: z.boolean().optional(),
  primary_email_address_id: z.string().nullable(),
  email_addresses: z.array(z.object({
    id: z.string(),
    email_address: z.string().email(),
    verification: z.object({ status: z.string() }).nullable(),
  })).max(100),
});
const Keys = z.object({
  keys: z.array(z.object({
    kid: z.string(), kty: z.string(), n: z.string().optional(), e: z.string().optional(),
  })).max(100),
});
const connectors = new ReplitConnectors();

async function nativeRead(path: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // The connector SDK does not expose AbortSignal. Bound these read-only
    // calls so a provider outage cannot hold the setup/link transaction open.
    return await Promise.race([
      connectors.proxy("clerk", path, { method: "GET" }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new NativeLinkError(
          503, "Account setup is temporarily unavailable. Please try again.",
        )), 10000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Only server-to-server provider data may establish a new account's email. */
export async function loadNativeSignupIdentity(who: NativeIdentity) {
  if (who.issuer !== nativeIssuer()) throw new NativeLinkError(401, "Sign in to the iPhone app again.");
  // Workspace connections can be replaced. Prove that the connected backend
  // belongs to the same instance that signed this app's verified JWT.
  const [backendKeys, issuerKeys] = await Promise.all([
    nativeRead("/v1/jwks"),
    fetch(`${nativeIssuer()}/.well-known/jwks.json`, {
      redirect: "error", signal: AbortSignal.timeout(10000),
    }),
  ]);
  if (!backendKeys.ok || !issuerKeys.ok) {
    throw new NativeLinkError(503, "Account setup is temporarily unavailable. Please try again.");
  }
  const a = Keys.parse(await backendKeys.json());
  const b = Keys.parse(await issuerKeys.json());
  if (!a.keys.some(k => k.kty === "RSA" && k.n && k.e
    && b.keys.some(e => e.kid === k.kid && e.n === k.n && e.e === k.e && e.kty === k.kty))) {
    throw new NativeLinkError(503, "iPhone account setup needs attention. Please try again later.");
  }
  const response = await nativeRead(`/v1/users/${encodeURIComponent(who.subject)}`);
  if (response.status === 404) throw new NativeLinkError(401, "Sign in to the iPhone app again.");
  if (!response.ok) throw new NativeLinkError(503, "Account setup is temporarily unavailable. Please try again.");
  const user = NativeUser.parse(await response.json());
  if (user.id !== who.subject || user.banned || user.locked) {
    throw new NativeLinkError(423, "This sign-in cannot create a PIXL account right now.");
  }
  const emails = user.email_addresses.filter(e => e.verification?.status === "verified");
  emails.sort((a, b) => Number(b.id === user.primary_email_address_id) - Number(a.id === user.primary_email_address_id));
  return {
    createdAt: user.created_at,
    verifiedEmails: [...new Set(emails.map(e => e.email_address.trim().toLowerCase()))],
  };
}
