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

Account-removal receipts must distinguish accepted requests from completed
cleanup. Completion email must use the verified native sign-in address, captured
before deleting that identity, never an inferred PWA address.

**Why:** The user requested immediate acknowledgement and a final email only
after deletion really finishes; a provider timeout can also hide a successful send.

**How to apply:** Keep deletion completion independent of email delivery.
Retry delivery without reopening access, use a stable provider idempotency key,
and require review rather than blindly retrying after its deduplication window.
Remove the temporary contact address after provider acceptance or seven days
after completed cleanup, so mail failures do not retain it indefinitely.
