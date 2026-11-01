---
name: Embedded native navigation titles
description: Why retained SwiftUI tool views must leave navigation titles to their container.
---

Embedded Prep, Track Stats (including Live Taps), and Share tools must leave the navigation title to the event container. Standalone tools may publish their own titles.

**Why:** Changing only the parent title did not change the iPhone header: embedded children still published “Event Details” and overrode it. Panels stay mounted to preserve drafts and fan QR state, so hiding them does not remove their navigation preferences.

**How to apply:** Suppress child navigation-title modifiers when embedded. Merely giving each child a different title can still leave inactive, retained panels competing with the active title. Verify switching steps after visiting an actual embedded editor, not only a read-only fixture.
