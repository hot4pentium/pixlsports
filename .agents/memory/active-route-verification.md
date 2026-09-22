---
name: Active route verification
description: Public and authenticated Pixl surfaces have separate component trees, so visual changes must be traced from the rendered route before editing.
---

The visible Pixl landing page and supporter dashboard do not share the legacy landing markup. Confirm the route’s rendered component and verify that surface directly before styling a similarly named section.

**Why:** A visually similar legacy section can remain in the codebase while the live route renders a newer component, making an apparently successful edit invisible to users.

**How to apply:** Trace the route entrypoint and capture the actual rendered page before deciding which component and stylesheet to change.