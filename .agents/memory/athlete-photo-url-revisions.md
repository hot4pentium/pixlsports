---
name: Athlete photo URL revisions
description: Keep original and cutout HYPE Card image URLs tied to the specific stored media object.
---

Version public original-photo and cutout URLs independently from their stored object identity. The image endpoint resolves each URL through the invite's current media slot, so it must reject a URL whose version no longer matches that slot.

**Why:** A shared invite timestamp lets an old URL silently return replacement media and causes replacing a cutout to invalidate the unchanged original.

**How to apply:** Generate the version from the selected photo or cutout object path. Accept a legacy invite-timestamp version only while it still matches the current invite; never use the invite timestamp for newly generated media URLs.
