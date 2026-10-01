---
name: Stale API client declarations
description: Refresh API client project-reference declarations before diagnosing missing generated exports in consumer type checks.
---

When `lib/api-client-react/src/generated/api.ts` contains a newly generated export but a consuming artifact reports it missing, check whether the package's `dist` declarations are older than the source. Refresh the package declarations with `pnpm --filter @workspace/api-client-react exec tsc -p tsconfig.json --pretty false` before changing the consuming code.

**Why:** TypeScript project references can resolve the API client package's built declarations, so stale output can make a valid generated hook look absent.

**How to apply:** Use this check when generated API source contains a symbol that downstream type checking cannot import; avoid editing application call sites until source and declaration output are synchronized.