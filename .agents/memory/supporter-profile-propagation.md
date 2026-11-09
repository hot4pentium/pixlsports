---
name: Supporter profile propagation
description: Sets the boundary between profile defaults and authored sports content.
---

Supporter profile athlete details should automatically seed new or local fan-tool work and live dashboard views. For a live/shared HYPE Card, the verified owner's current profile name is authoritative; persist corrections through owner-authorized writes so other viewers receive the same identity. Non-owner reads stay read-only. Do not silently rewrite explicitly saved cloud designs or already-published share snapshots when the profile changes.

**Why:** A live card represents the athlete’s current identity, while saved and published content may represent a deliberate past design or a different game. Only the invite owner controls identity updates.

An explicit owner save in native Settings automatically updates the owner's live HYPE Card name, even after an earlier rename left it mismatched. The HYPE Card always uses the Settings name; a nickname can be entered there, not in a separate card-only field. No identity confirmation is required for this save. Visibility, pause, media, and publication settings remain unchanged.

**Why:** The user chose “Always match the Settings name” and “Sync automatically on save” after a transient identity-confirmation prompt prevented a rename. Profile details and consent to publish remain separate choices.

**How to apply:** Preserve verified ownership and setup-retry safeguards. Persist live-card identity in the explicit profile-save flow; show queued profile names in owner-only caches until reconnect. Never apply local owner overrides to public recipients, authored exports, or published snapshots.

Legacy identity-repair endpoints still require verified owner authorization. Ordinary Settings name saves must not depend on that separate repair dialog or token.

**Why:** The owner explicitly authorized automatic Settings-name propagation, not any relaxation of access controls or changes to sharing choices.

**How to apply:** Keep repair authorization tests intact while covering repeated profile renames, pre-existing mismatches, offline queued names, and unchanged privacy and authored content.

When the owner creates their first HYPE Card, automatically copy their saved Athlete Profile photo. Preserve the private original and publish only an independently stored, sanitized card copy. Do not backfill existing cards or replace their chosen photos when profile photos change.

**Why:** The user authorized automatic photo handoff during fresh onboarding, not ongoing photo synchronization or changes to existing cards.

**How to apply:** Limit copying to card creation. If a saved photo exists but cannot be prepared, fail before creating the card so retry does not leave a partially created, photo-less card. Accounts without saved athlete photos may still create cards.