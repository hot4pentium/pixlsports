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