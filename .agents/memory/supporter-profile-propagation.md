---
name: Supporter profile propagation
description: Sets the boundary between profile defaults and authored sports content.
---

Supporter profile athlete details should automatically seed new or local fan-tool work and live dashboard views. For a live/shared HYPE Card, the verified owner's current profile name is authoritative; persist corrections through owner-authorized writes so other viewers receive the same identity. Non-owner reads stay read-only. Do not silently rewrite explicitly saved cloud designs or already-published share snapshots when the profile changes.

**Why:** A live card represents the athlete’s current identity, while saved and published content may represent a deliberate past design or a different game. Only the invite owner controls identity updates.

**How to apply:** Read the normalized supporter profile at tool entry. On live-card routes, apply its name only after confirming invite ownership and persist any correction through an owner-only save. Preserve authored cloud/share data unless the user explicitly edits it.

When the owner creates their first HYPE Card, automatically copy their saved Athlete Profile photo. Preserve the private original and publish only an independently stored, sanitized card copy. Do not backfill existing cards or replace their chosen photos when profile photos change.

**Why:** The user authorized automatic photo handoff during fresh onboarding, not ongoing photo synchronization or changes to existing cards.

**How to apply:** Limit copying to card creation. If a saved photo exists but cannot be prepared, fail before creating the card so retry does not leave a partially created, photo-less card. Accounts without saved athlete photos may still create cards.