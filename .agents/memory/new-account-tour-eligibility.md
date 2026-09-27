---
name: New-account tour eligibility
description: Why optional dashboard onboarding starts only for accounts explicitly marked during new supporter setup.
---

Only a supporter whose account setup explicitly marked the dashboard tour as pending should see it automatically. A missing tour status means no automatic tour, not an unfinished tour. Finished and skipped supporters may replay from the dashboard.

**Why:** A release that interprets absent completion as eligibility would unexpectedly interrupt every established account. Signup and setup provide a reliable point to opt new accounts into the first-visit experience.

**How to apply:** For future onboarding, write eligibility at the new-account handoff and preserve the done state on subsequent metadata updates. Keep replay independent from automatic eligibility.