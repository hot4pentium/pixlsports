---
name: Native account deletion boundary
description: Scope and provider safety for iPhone account-removal requests.
---

Independent iPhone profiles may be permanently purged; removal of a legacy-linked
iPhone identity must preserve the PWA identity and all PWA-owned data.

**Why:** Native and PWA identities belong to separate Clerk instances, but older
native bindings access shared PWA content. An iPhone deletion request must not
become permission to destroy that shared account.

**How to apply:** Resolve ownership from verified native issuer/subject, not email
or identifier format. Prove the server provider connection matches that issuer
before deleting a native identity. Retain a minimal terminal deletion marker
after profile cleanup so outstanding tokens and setup retries cannot recreate
access. Provider or storage failures must remain retryable without reopening
access or changing the deletion scope. Bounded retry batches must rotate even
failed or locked requests; selecting only the oldest unfinished requests can
permanently exclude newer requests when a full batch keeps failing.
