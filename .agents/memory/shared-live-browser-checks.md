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

When tracking ends, publish the final state to the existing spectator link independently of the separate private cloud-history save. Show a visible, dismissible thank-you and a Follow athlete action only if the matching public HYPE Card is available. Later cloud conflict resolution must be able to update an already-final link if the saved game changes.

**Why:** A viewer otherwise keeps seeing LIVE, or misses an inline message below the fold, while the owner's unrelated history upload is delayed or fails. A resolved history conflict must not strand the public final at an obsolete score.

**How to apply:** Keep the link's final update queued after outstanding live updates; retain independent history retry and explicit conflict handling. Test with the private save intentionally held while the public link finalizes, then test the recipient prompt on an already-open mobile page.