---
name: Athlete identity visuals
description: Keeps supporter account identity separate from the athlete represented in game-day tools.
---

Athlete photo uploads belong only in the HYPE Card manager. The dashboard and tracker may reuse a HYPE Card photo only when that card matches the selected athlete; otherwise use the athlete’s initials. Never use the supporter’s account photo.

Athlete Profile contains names and team details, not a separate photo upload. New HYPE Cards start without a photo until the owner uploads one through Manage HYPE Card. Keep existing server-side Athlete Profile photo records intact, but do not copy or surface them in the app. Clear the departed account’s local photo metadata and cached image bytes on sign-out or account switch.

**Why:** The user said multiple avatars are confusing and photo uploads should live only in the HYPE Card process. Existing private profile-photo data is preserved rather than deleted.

**How to apply:** Before showing an athlete image in dashboard or tracker UI, match the saved HYPE Card to the current athlete and use its photo. If there is no match or photo, render initials. Keep the owner upload/edit flow in Manage HYPE Card and do not couple card creation to legacy profile-photo storage.

Describe the upload as the photo for the public HYPE Card, not a separate athlete-profile photo. Explain public visibility conditionally: uploading a photo does not publish a private card.

**Why:** The user found the athlete-photo description contradictory and said the only photo uploaded should be for the public HYPE Card.

**How to apply:** Use HYPE Card photo terminology throughout upload guidance and status messages. Do not imply that uploading also changes the card's privacy.