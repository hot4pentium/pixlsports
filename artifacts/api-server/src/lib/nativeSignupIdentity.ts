import { ReplitConnectors } from "@replit/connectors-sdk";
import { z } from "zod/v4";
import { NativeLinkError, nativeIssuer, type NativeIdentity } from "./nativeIdentity";

const NativeUser = z.object({
  id: z.string(),
  created_at: z.number(),
  banned: z.boolean(),
  locked: z.boolean().optional(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
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

async function nativeRead(path: string, method: "GET" | "DELETE" = "GET") {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // The connector SDK does not expose AbortSignal. Bound calls; DELETE can
    // have an uncertain outcome, but retrying the same subject is idempotent.
    return await Promise.race([
      connectors.proxy("clerk", path, { method }),
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

const providerDependencies = {
  read: nativeRead,
  issuerKeys: (issuer: string) => fetch(`${issuer}/.well-known/jwks.json`, {
    redirect: "error", signal: AbortSignal.timeout(10000),
  }),
  remove: (subject: string) => nativeRead(`/v1/users/${encodeURIComponent(subject)}`, "DELETE"),
};

export async function assertNativeProviderConnection(who: NativeIdentity, deps = providerDependencies) {
  if (who.issuer !== nativeIssuer()) throw new NativeLinkError(401, "Sign in to the iPhone app again.");
  // Workspace connections can be replaced. Prove that the connected backend
  // belongs to the same instance that signed this app's verified JWT.
  const [backendKeys, issuerKeys] = await Promise.all([
    deps.read("/v1/jwks"),
    deps.issuerKeys(nativeIssuer()),
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
}

export async function loadNativeProviderIdentity(who: NativeIdentity) {
  await assertNativeProviderConnection(who);
  const response = await nativeRead(`/v1/users/${encodeURIComponent(who.subject)}`);
  if (response.status === 404) throw new NativeLinkError(401, "Sign in to the iPhone app again.");
  if (!response.ok) throw new NativeLinkError(503, "Account setup is temporarily unavailable. Please try again.");
  const user = NativeUser.parse(await response.json());
  if (user.id !== who.subject) {
    throw new NativeLinkError(503, "The iPhone provider returned a different identity.");
  }
  return user;
}

/** Deleting the dedicated native user revokes all its sessions, never a web user.
 * Recheck the connector/issuer match on every retry; a 404 is already deleted.
 */
export function createNativeProviderDeletion(deps = providerDependencies) {
  return async (who: NativeIdentity) => {
    await assertNativeProviderConnection(who, deps);
    const response = await deps.remove(who.subject);
    if (!response.ok && response.status !== 404) {
      throw new NativeLinkError(503, "iPhone account deletion will be retried.");
    }
  };
}
export const deleteNativeProviderIdentity = createNativeProviderDeletion();

export async function loadNativeSignupIdentity(who: NativeIdentity) {
  const user = await loadNativeProviderIdentity(who);
  if (user.banned || user.locked) {
    throw new NativeLinkError(423, "This sign-in cannot create a PIXL account right now.");
  }
  const emails = user.email_addresses.filter(e => e.verification?.status === "verified");
  emails.sort((a, b) => Number(b.id === user.primary_email_address_id) - Number(a.id === user.primary_email_address_id));
  return {
    createdAt: user.created_at,
    verifiedEmails: [...new Set(emails.map(e => e.email_address.trim().toLowerCase()))],
  };
}
