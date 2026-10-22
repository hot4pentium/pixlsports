---
name: Shared live browser checks
description: Browser coverage for state shared between an owner workflow and a live spectator view.
---

For owner-published live state, open the spectator view before a later owner update and verify that the already-open view refreshes. Also verify that finalization removes the live state while preserving its history.

**Why:** Reopening the spectator page only verifies its initial fetch; it does not catch failures in the refresh path that keeps an active audience view current.

**How to apply:** Keep owner and spectator browser sessions open together for live-scoreboard, shared-status, and other polled or refreshed views. Use a fresh page only for separate initial-load assertions.

When a spectator response also derives a public link from independently editable owner data, verify that a refresh replaces the link even when the shared game revision is unchanged. The API test needs a real invite fixture, and the browser test should keep the final scoreboard open through rotation.

**Why:** Public-card tokens can change without a tracker update, so an event stream keyed only to tracker revisions cannot by itself keep the derived link current.

**How to apply:** Test the database-backed response after token rotation and the existing spectator page's polling path; confirm the old destination is gone while the final score and thank-you remain.