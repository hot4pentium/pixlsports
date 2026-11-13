import { NativeLinkError } from "./nativeIdentity";

type NativeClerkEnvironment = {
  NODE_ENV?: string;
  NATIVE_IOS_CLERK_PRODUCTION_SECRET_KEY?: string;
};
type NativeClerkMethod = "GET" | "DELETE";
type DiagnosticCode =
  | "production_key_missing"
  | "production_key_invalid"
  | "request_path_invalid"
  | "request_timeout"
  | "request_failed"
  | "key_lookup_failed"
  | "backend_keys_unavailable"
  | "issuer_keys_unavailable"
  | "keys_invalid"
  | "instance_mismatch";

/** Only this fixed code is logged; never include provider bodies or credentials. */
export class NativeClerkProviderError extends NativeLinkError {
  constructor(public diagnosticCode: DiagnosticCode) {
    super(503, "iPhone account setup is temporarily unavailable. Please try again later.");
  }
}

type Dependencies = {
  proxy: (path: string, init: { method: NativeClerkMethod }) => Promise<Response>;
  environment?: () => NativeClerkEnvironment;
  fetchRequest?: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
};

/**
 * Production uses only the dedicated native live key. A shared production key
 * must never replace the development connector or the PWA's managed Clerk keys.
 */
export function createNativeClerkRead({
  proxy,
  environment = () => process.env,
  fetchRequest = (url, init) => fetch(url, init),
  timeoutMs = 10000,
}: Dependencies) {
  return async (path: string, method: NativeClerkMethod = "GET"): Promise<Response> => {
    if (!/^\/v1\/users\/user_[A-Za-z0-9]+$/.test(path)
      && !(path === "/v1/jwks" && method === "GET")) {
      throw new NativeClerkProviderError("request_path_invalid");
    }
    const env = environment();
    const production = env.NODE_ENV === "production";
    const secret = production ? env.NATIVE_IOS_CLERK_PRODUCTION_SECRET_KEY?.trim() : undefined;
    if (production && !secret) throw new NativeClerkProviderError("production_key_missing");
    if (production && (!secret?.startsWith("sk_live_") || secret.length <= 8 || /\s/.test(secret))) {
      throw new NativeClerkProviderError("production_key_invalid");
    }

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const request = production
        ? fetchRequest(`https://api.clerk.com${path}`, {
          method,
          headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" },
          redirect: "error",
          cache: "no-store",
          signal: controller.signal,
        })
        : proxy(path, { method });
      // The development connector has no AbortSignal support. Both transports
      // are bounded; production fetch is also actively aborted on timeout.
      return await Promise.race([
        request,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new NativeClerkProviderError("request_timeout"));
            controller.abort();
          }, timeoutMs);
        }),
      ]);
    } catch (error) {
      if (error instanceof NativeClerkProviderError) throw error;
      throw new NativeClerkProviderError("request_failed");
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}
