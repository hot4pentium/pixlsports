---
name: App-only identity blocks
description: Policy boundary for temporarily blocking a Clerk identity without deleting the identity or app data.
---

An Admin identity block applies only to a Clerk identity with no Pixl Sports account-access record. It is app-only, reversible, and audited: deny private app access and first-time setup, but do not delete the Clerk identity, stored app data, or public share links. Existing app accounts use the separate Admin suspension control.

**Why:** The user selected this control because their Replit tier does not allow deleting Clerk accounts; blocking must remain separate from identity or data deletion.

**How to apply:** Keep both normal private API authorization and first-time account setup covered. Never implement an app-only block through Clerk deletion, account purging, or revocation of public shares.

## Independent iPhone administration

Keep reversible iPhone access management independent of provider availability. If the iOS connector cannot confirm identity details, show that those details are unavailable rather than looking up a same-email PWA identity.

**Why:** Provider downtime must not prevent an administrator from restricting an existing native owner, and matching email addresses do not establish shared ownership.

**How to apply:** Act on the native canonical owner. Keep the PWA permanent-deletion pipeline unavailable for independent native accounts until cleanup explicitly supports the iOS provider; never send native owner hashes to the managed PWA identity service.
