---
name: Shared live browser checks
description: Browser coverage for state shared between an owner workflow and a live spectator view.
---

For owner-published live state, open the spectator view before a later owner update and verify that the already-open view refreshes. Also verify that finalization removes the live state while preserving its history.

**Why:** Reopening the spectator page only verifies its initial fetch; it does not catch failures in the refresh path that keeps an active audience view current.

**How to apply:** Keep owner and spectator browser sessions open together for live-scoreboard, shared-status, and other polled or refreshed views. Use a fresh page only for separate initial-load assertions.