---
name: Supporter photo query cache
description: Profile photo mutations must refresh account-scoped tracker queries as well as the shared generated endpoint key.
---

Supporter photo cache helpers must update every query whose key starts with the generated supporter-photo endpoint key, not only the exact base key.

**Why:** The live tracker scopes its React Query entry by account to prevent cross-account leakage, while profile screens use the generated base key. Updating only the base entry leaves an active or resumed tracker showing stale media and crop data.

**How to apply:** Use React Query’s non-exact matching for supporter-photo cache writes and removals, and keep account-scoped tracker coverage in cache tests and browser flows.