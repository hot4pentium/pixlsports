---
name: Time-relative browser expiries
description: Keep browser fixtures for expiring shares valid as the environment date advances.
---

Browser fixtures for active shared links should calculate their expiry relative to the test runtime instead of hard-coding a calendar date.

**Why:** Once a fixed expiry passes, the app correctly renders the unavailable state, so tests fail before exercising the intended active-share behavior.

**How to apply:** Give happy-path fixtures a future-relative expiry, then set explicit past or near-future expiries in tests that cover expired or expiring links.