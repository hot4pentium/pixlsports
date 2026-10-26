---
name: Account lifecycle browser identity fixtures
description: Clerk identity data required by the account lifecycle setup and provisioning API in browser tests.
---

Browser Clerk stubs used for first-account setup must provide verified `emailAddresses` and a matching verified-email ownership lookup. A primary email alone is not enough.

**Why:** The real setup endpoint requires at least one verified address and checks that it is not already attached to another app account before saving. A minimal auth mock can therefore make setup fail for reasons unrelated to the browser flow being tested.

**How to apply:** When a browser test exercises first-time account setup, make the fake Clerk identity and its user-list response satisfy the same verification and ownership contract as the API. Also isolate the athlete-editor identity lookup: injecting provisioning alone does not stop that separate check from contacting real Clerk with a fake test user.

**Why the separate lookup matters:** A fixture can fail with an unrelated Clerk “Not Found” before reaching its injected provisioning flow. Keep the production identity check as the default; override it only for test-owned identities.