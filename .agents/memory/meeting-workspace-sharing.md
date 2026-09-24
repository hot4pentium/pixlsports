---
name: Meeting workspace sharing
description: Ownership, local-draft, conflict, and public-recap boundaries for meeting capture.
---

Meeting capture remains local-first. Loading or saving a cloud workspace must never erase an existing local draft; stale cross-device writes preserve the local copy and surface a conflict.

**Why:** Coaches may capture notes while offline or edit the same meeting on multiple devices. Silent replacement would lose attendance, decisions, or follow-ups.

**How to apply:** Keep owner workspace reads and writes authenticated and revisioned. Public recap links use a separate opaque token, expose only the structured recap snapshot, and remain read-only without owner or account identifiers.