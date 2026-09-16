---
name: Live role routing
description: The studio must replace role-specific UI when Clerk metadata changes during an already-mounted session.
---

Role-specific studio navigation and controls must be selected from the current Clerk user metadata during render. Do not cache the initial role as session state.

**Why:** Clerk can update the same signed-in user object after profile or account changes; stale role state can leave coach-only or fan-only controls visible.

**How to apply:** Keep the authenticated studio boundary reactive to the current user, and cover both fan-to-coach and coach-to-fan transitions plus loading and missing-role states.