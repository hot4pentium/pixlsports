---
name: HYPE Card settings revisions
description: Why native HYPE Card edits use a settings fingerprint for stale-write protection.
---

Use an opaque fingerprint of the authoritative HYPE Card settings as the iPhone's concurrency revision. Derive it from the complete editable settings, return it with authoritative settings, and compare it under the invite row lock before writing. On a stale revision, rebase the account-scoped iPhone save intent against the latest settings and retry; retain the local queue until the requested values are confirmed.

**Why:** Card timestamps also change for unrelated work and web writes may share timestamp precision. A settings fingerprint detects a changed setting without false conflicts from photos or other card activity. If the editable settings contract changes, update the fingerprint inputs with it.

**How to apply:** Keep revision generation identical on owner reads, locked updates, and save responses. Reject stale writes before applying any submitted field. Keep iPhone-edited fields and remote-only fields through automatic rebases, and never clear a queued save after an uncertain network result.
