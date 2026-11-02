---
name: New-account tour eligibility
description: Why optional dashboard onboarding starts only for accounts explicitly marked during new supporter setup.
---

Only a supporter whose account setup explicitly marked the dashboard tour as pending should see it automatically. A missing tour status means no automatic tour, not an unfinished tour. Finished and skipped supporters may replay from the dashboard.

**Why:** A release that interprets absent completion as eligibility would unexpectedly interrupt every established account. Signup and setup provide a reliable point to opt new accounts into the first-visit experience.

**How to apply:** For future onboarding, write eligibility at the new-account handoff and preserve the done state on subsequent metadata updates. Keep replay independent from automatic eligibility.

An unfinished tour should remain on its current step when a supporter opens an example or returns to the dashboard in the same browser tab. Keep examples from replacing the tour tab; clear in-tab progress only after Finish or Skip succeeds.

**Why:** Opening an example previously remounted the dashboard tour and returned the supporter to step one before they had finished.

**How to apply:** Preserve per-account, per-tab progress across route and responsive-layout remounts without changing who is eligible to auto-start.

## Native first-dashboard welcome

When a new iPhone user first reaches their dashboard, show a modal explaining that the Message Board guides them through the week. Introduce the steps in order: Prep, Track Stats (including the Live Taps alternative), then Share.

**Why:** The user wants families to know what to expect throughout the week and where to look for the next action.

**How to apply:** Present after athlete setup and dashboard readiness, never over authentication or the setup form. Explicitly enroll during initial setup and remember acknowledgement separately for each account and native authentication instance on the device. Do not automatically enroll established accounts just because a preference is absent, and do not replay after ordinary navigation or refresh.