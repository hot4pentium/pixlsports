# Photo storage readiness

`GET /api/healthz` remains API liveness (`200 {"status":"ok"}`), independent of storage.
`GET /api/healthz/photo-storage` is a separate capability check: `200` with
`{"status":"ready"}`, or `503` with `{"status":"unavailable","reason":"configuration"|"access"}`.
It returns no bucket names, paths, credentials, provider errors, or image data.

Readiness validates `PRIVATE_OBJECT_DIR` (a bucket plus private directory) and
rejects directories exposed by `PUBLIC_OBJECT_SEARCH_PATHS`. Public paths and
`DEFAULT_OBJECT_STORAGE_BUCKET_ID` are not required for the private upload path:
that path selects its bucket directly from `PRIVATE_OBJECT_DIR`.
The access probe lists at most one private-prefix object without downloading
images or writing fixtures. Successes and failures are cached for 30 seconds,
concurrent requests share a check, and requests time out after five seconds.
Configuration is checked on every call. Read-only readiness is not proof of
write permission; use the smoke command after provisioning or access changes.

The authenticated native endpoint
`GET /api/native/supporter/hype-card/athlete-photo/readiness` uses the same check.
The native photo section checks it before enabling the picker, shows a retryable
photo-specific message on failure, and leaves schedule and tracker access alone.
Photo metadata and existing photo-removal actions remain separate.

## Operator smoke command

Run in the environment whose storage you need to verify:

```sh
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server smoke:photo-storage
```

This explicitly writes one tiny generated WebP under a dedicated private smoke
prefix, applies the normal private photo ACL, verifies owner-only access,
compares downloaded bytes, and verifies an unauthenticated storage request is
denied. No athlete records, database fixtures, or real photos are used.
Deletion runs in `finally`, retries transient failures up to three times, and
confirms absence. A cleanup failure is a failing check, never a silent success.
No storage check can guarantee cleanup during a process kill or a persistent
provider outage; after a reported cleanup failure, operators should remove
leftover objects in the dedicated `photo-storage-smoke` prefix through storage
management, without touching athlete photo objects.

Output contains only the check name, status, and safe failure stage. Exit status
is nonzero on failure. Never print underlying exceptions, configured paths, or
signed URLs when investigating a failure. Health requests never run this command.
