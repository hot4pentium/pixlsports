---
name: Athlete fan card and Hype Page lifecycle
description: Primary fan-card sharing, preserved original pages, pause/resume behavior, and live-session boundaries.
---

The living athlete fan card is the primary supporter-facing destination. The original Athlete Hype Page remains a separate, usable experience at its existing URL; both are backed by the same durable athlete identity, and season dates provide context rather than expiring the URL. Pausing hides public access until the owner resumes it and revokes any attached Game Day Live session. Game Day Live is optional and short-lived, and stopping it returns the card to finalized stats.

Owner management belongs on its own owner-only route reached from the stable Hype Page, not embedded in the public page and not isolated behind a studio-only entry point. The public page may reveal only the management link after matching the route token against the authenticated account's protected invite list; the management route repeats that ownership check and server mutations still enforce ownership.

**Why:** The user chose the photo-first card as the main fan interface without replacing the original Hype Page or the separate temporary live experience.

**How to apply:** Share the card URL first, preserve the original page and legacy one-off share URLs, and keep the athlete token stable across pause/resume. Let only the owner load a paused page. A public card may show a view-only live scoreboard but must not expose the reusable live-session token or raw tracker events; treat the live session as an independently revocable attachment rather than replacing either durable experience.

The new fan card's Videos side is for videos, not older Hype Card photo shares. The original Athlete Hype Page may still show those image shares.

**Why:** An old Hype Card photo appeared unexpectedly when a supporter opened Videos on the new fan card. Removing it from that view should not delete the photo or break old shares.

**How to apply:** Do not reuse the legacy Hype Card image slot on the new card's Videos side. Keep any changes to media provenance separate from deleting existing shared media.

The four-step standalone Hype Card editor is retired. The diagonal “HYPE CARD” label belongs on the new athlete fan card’s photo, not as a reason to reopen the old creator. Existing one-off public shares and historical saved-design bytes remain intact even though the old editor is no longer an active destination.

**Why:** The user explicitly chose the athlete fan card as the new card and asked to remove the old walkthrough path without deleting historical content.

**How to apply:** Route new creation and sharing through the athlete fan card and its manager. Do not restore old editor entry points or delete legacy share links and saved designs during navigation cleanup.