---
name: Active route verification
description: Public and authenticated Pixl surfaces have separate component trees, so visual changes must be traced from the rendered route before editing.
---

The visible Pixl landing page and supporter dashboard do not share the legacy landing markup. Confirm the route’s rendered component and verify that surface directly before styling a similarly named section.

**Why:** A visually similar legacy section can remain in the codebase while the live route renders a newer component, making an apparently successful edit invisible to users.

**How to apply:** Trace the route entrypoint and capture the actual rendered page before deciding which component and stylesheet to change.

For tracker requests, verify the Event Card's compact tracker as well as the standalone full tracker before declaring completion.

**Why:** A football-label change verified only in the full tracker left the parent's actual Event Card controls unchanged; the user still saw PASS YDS and RUSH YDS.

**How to apply:** Include both live tracking surfaces in regression checks for stat-card labels and actions. Do not treat a passing standalone tracker test as coverage of the compact tracker.