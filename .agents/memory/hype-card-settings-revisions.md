---
name: HYPE Card settings revisions
description: Why native HYPE Card edits use a settings fingerprint for stale-write protection.
---

Use an opaque fingerprint of the authoritative HYPE Card settings as the iPhone's concurrency revision. Derive it from the complete editable settings, return it with authoritative settings, and compare it under the invite row lock before writing.

**Why:** Card timestamps also change for unrelated work and web writes may share timestamp precision. A settings fingerprint detects a changed setting without false conflicts from photos or other card activity. If the editable settings contract changes, update the fingerprint inputs with it.

**How to apply:** Keep revision generation identical on owner reads, locked updates, and save responses. Reject stale writes before applying any submitted field, then preserve the local iPhone draft until the owner explicitly reviews it or reloads the server settings.
