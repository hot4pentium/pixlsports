---
name: Athlete identity visuals
description: Keeps supporter account identity separate from the athlete represented in game-day tools.
---

Athlete photos belong to the HYPE Card: the web uploads live in its manager, while native iOS provides the same photo in Settings → Athlete profile → Athlete photo. The dashboard and tracker may reuse a HYPE Card photo only when that card matches the selected athlete; otherwise use the athlete’s initials. Never use the supporter’s account photo.

The native Settings upload edits the existing HYPE Card photo, not a separate profile-photo record. New HYPE Cards start without a photo until the owner uploads one. Keep existing server-side legacy Athlete Profile photo records intact, but do not copy or surface them in the app. Clear the departed account’s local photo metadata and cached image bytes on sign-out or account switch.

**Why:** The user said multiple avatars are confusing and photo uploads should live only in the HYPE Card process; they later explicitly requested the iOS upload in Settings. Both entry points must edit the same card image. Existing private profile-photo data is preserved rather than deleted.

**How to apply:** Before showing an athlete image in dashboard or tracker UI, match the saved HYPE Card to the current athlete and use its photo. If there is no match or photo, render initials. Keep web uploads in Manage HYPE Card and native uploads in Settings; do not couple either to legacy profile-photo storage.

Describe the upload as the photo for the public HYPE Card, not a separate athlete-profile photo. Explain public visibility conditionally: uploading a photo does not publish a private card.

**Why:** The user found the athlete-photo description contradictory and said the only photo uploaded should be for the public HYPE Card.

**How to apply:** Use HYPE Card photo terminology throughout upload guidance and status messages. Do not imply that uploading also changes the card's privacy.

The native HYPE Card and athlete-photo screens must not show raw server hosts, HTTP status codes, or backend response text. Use brief, operation-specific messages and keep retry or review actions available.

**Why:** The user said families should not see technical server errors while viewing their HYPE Card.

**How to apply:** Map errors from card preview, photo loading, upload, removal, settings, and identity actions to plain-language status copy at the UI boundary.