import { ReplitConnectors } from "@replit/connectors-sdk";
import { z } from "zod/v4";
import { NativeLinkError, nativeIssuer, type NativeIdentity } from "./nativeIdentity";
import { createNativeClerkRead, NativeClerkProviderError } from "./nativeClerkProvider";

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

const nativeRead = createNativeClerkRead({
  proxy: (path, init) => connectors.proxy("clerk", path, init),
});

const providerDependencies = {
  read: nativeRead,
  issuerKeys: (issuer: string) => fetch(`${issuer}/.well-known/jwks.json`, {
    redirect: "error", signal: AbortSignal.timeout(10000),
  }),
  remove: (subject: string) => nativeRead(`/v1/users/${encodeURIComponent(subject)}`, "DELETE"),
};

export async function assertNativeProviderConnection(who: NativeIdentity, deps = providerDependencies) {
  if (who.issuer !== nativeIssuer()) throw new NativeLinkError(401, "Sign in to the iPhone app again.");
  // Credentials can be replaced. Prove that the backend belongs to the same
  // instance that signed this app's verified JWT before reading/deleting users.
  let backendKeys: Response, issuerKeys: Response;
  try {
    [backendKeys, issuerKeys] = await Promise.all([
      deps.read("/v1/jwks"),
      deps.issuerKeys(nativeIssuer()),
    ]);
  } catch (error) {
    if (error instanceof NativeClerkProviderError) throw error;
    throw new NativeClerkProviderError("key_lookup_failed");
  }
  if (!backendKeys.ok) throw new NativeClerkProviderError("backend_keys_unavailable");
  if (!issuerKeys.ok) throw new NativeClerkProviderError("issuer_keys_unavailable");
  let a: z.infer<typeof Keys>, b: z.infer<typeof Keys>;
  try {
    a = Keys.parse(await backendKeys.json());
    b = Keys.parse(await issuerKeys.json());
  } catch {
    throw new NativeClerkProviderError("keys_invalid");
  }
  if (!a.keys.some(k => k.kty === "RSA" && k.n && k.e
    && b.keys.some(e => e.kid === k.kid && e.n === k.n && e.e === k.e && e.kty === k.kty))) {
    throw new NativeClerkProviderError("instance_mismatch");
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
 * Recheck the credential/issuer match on every retry; a 404 is already deleted.
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
