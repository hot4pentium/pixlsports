---
name: Upload claim cleanup races
description: Concurrency rule for safely deleting objects left behind by expiring upload claims.
---

Confirmation must atomically renew or reserve a still-valid upload claim before performing storage work. Cleanup may delete only claims that remain expired after that atomic operation, and must verify that no active record references the object before deleting bytes.

**Why:** Selecting a valid claim without changing it leaves a race: scheduled cleanup can remove the claim and object while the confirmation request is still processing.

**How to apply:** Use this pattern for every presigned-upload flow that has expiring claims and a scheduled abandoned-object purge. Keep non-not-found storage failures retryable by restoring or retaining the claim.