---
name: Public athlete page boundaries
description: Privacy, attribution, media, and link-rotation invariants for public athlete pages.
---

Public Athlete Hype Pages may refresh statistics only from an owner-owned Stat Tracker project. Season stat totals and stat trends retain their combined team-and-athlete meaning; points/runs are team scores. Per-game athlete counts are aggregated only from finalized events explicitly attributed to the named athlete. The public payload may include the athlete display name, selected sport, finalized-game count, score, flattened finalized game summaries (date, opponent, both scores, validated combined counts, and athlete-attributed counts), season aggregates, and update time. Never expose tracker project IDs, share identity keys, raw game IDs, events, event IDs, timestamps, notes, active games, account IDs, or unrelated sports.

**Why:** These pages are accessible to anyone with the token. Families need both an individual game recap and continuity across combined season trends, but generic cloud-project data contains private and unrelated fields that must not cross the public boundary.

**How to apply:** Treat the server response—not the browser—as the privacy boundary. Re-check project ownership and type on each refresh, summarize only finalized games for the selected sport, keep existing combined totals/trends unchanged, and compute athlete-only counts strictly from explicit athlete attribution. Do not return raw event details.

Still-image shares use a prepared flattened card rendition rather than the original upload. Existing video/poster storage columns remain the compatibility layer for both media types.

**Why:** A flattened rendition avoids publishing original media and prevents the public renderer from applying the design twice.

**How to apply:** Render image shares directly as the hosted card. Use the saved manifest only to composite hosted video inside the card design.

Only one non-revoked public URL may exist per owner and Hype Card design identity. Replacement must revoke matching current and legacy links inside the server transaction; media cleanup can retry afterward.

**Why:** Client-side discovery is truncated and can race across tabs. Best-effort client deletion can leave an old private URL active after the owner believes it was refreshed.

**How to apply:** Enforce link identity and rotation in the database/API. Keep legacy manifest-key matching until all older rows have an explicit identity value.