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

Operator visibility into deletion mail is read-only and must not depend on a
surviving profile or reveal the temporarily retained recipient.

**Why:** The user requested mail-stage visibility separately from stuck-cleanup
alerts, without recreating deleted identities or adding blind resend/reactivation
controls. Provider acceptance must never be described as delivery or reading.

**How to apply:** Present the minimal deletion reference and mail-stage evidence;
keep uncertain sends distinct from definite rejections, and treat expired
contact retention as a sending limit, not proof that an email was sent.

Deletion support references are non-secret identifiers, never credentials for
deletion, recovery, or private status access.

**Why:** A signed-out user must be able to identify their removal request without
keeping athlete details or an email address on the device.

**How to apply:** Support procedures must still verify identity independently;
knowing or copying the reference does not establish account ownership.

Receipt navigation must refresh cached native authentication before signing out,
and show progress or a visible retry error while preserving the deletion receipt.

**Why:** A deleted identity can leave a stale SDK session; silent remote sign-out
made “Back to sign in” appear unresponsive. A failed transition must not reopen
private content or discard proof that deletion was accepted.

**How to apply:** Keep the receipt until the SDK confirms signed-out state, reset
the sign-in presentation for the next account, and place retry errors beside the
receipt action rather than in an off-screen overlay.

After iOS deletion is accepted, a new iOS profile or connection using the same
verified email must remain blocked until cleanup finishes. Email delivery or
opening the completion email must not control release of that hold.

**Why:** The user explicitly asked to prevent someone cancelling and signing up
again faster than the deletion system can finish.

**How to apply:** Enforce the hold server-side across signup and legacy linking,
including when the old provider identity is already gone but cleanup is retrying.
Use verified native emails only as temporary exclusions, never as ownership proof
or a reason to connect PWA data. A completed deletion permits a fresh identity
and empty profile; it never restores the deleted identity or data.
