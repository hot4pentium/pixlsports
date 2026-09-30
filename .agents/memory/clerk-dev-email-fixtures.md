---
name: Development Clerk email fixtures
description: Safe live checks of Clerk verified-email search in the managed development tenant.
---

Clerk's Backend API rejected synthetic `.test` email addresses with `form_param_format_invalid`, while unique generated `@example.com` addresses were accepted for temporary development identities. Verify both the secret and publishable keys are test-environment keys before any user creation, and remove every temporary identity afterward.

**Why:** A live search check is useful for validating SDK behavior beyond mocked tests, but a wrong tenant or leftover identity could affect real users.

**How to apply:** For a temporary verified-email search check, use development keys only, generate unique non-personal addresses, assert both verified inclusion and unverified exclusion, and log neither addresses nor user IDs.