---
name: Athlete fan card and Hype Page lifecycle
description: Primary fan-card sharing, preserved original pages, pause/resume behavior, and live-session boundaries.
---

The living athlete fan card is the primary supporter-facing destination. The original Athlete Hype Page remains a separate, usable experience at its existing URL; both are backed by the same durable athlete identity, and season dates provide context rather than expiring the URL. Pausing hides public access until the owner resumes it and revokes any attached Game Day Live session. Game Day Live is optional and short-lived, and stopping it returns the card to finalized stats.

Owner management belongs on its own owner-only route reached from the stable Hype Page, not embedded in the public page and not isolated behind a studio-only entry point. The public page may reveal only the management link after matching the route token against the authenticated account's protected invite list; the management route repeats that ownership check and server mutations still enforce ownership.

**Why:** The user chose the photo-first card as the main fan interface without replacing the original Hype Page or the separate temporary live experience.

**How to apply:** Share the card URL first, preserve the original page and legacy one-off share URLs, and keep the athlete token stable across pause/resume. Let only the owner load a paused page. A public card may show a view-only live scoreboard but must not expose the reusable live-session token or raw tracker events; treat the live session as an independently revocable attachment rather than replacing either durable experience.

The shared Player Showcase presents the athlete’s sport-specific jersey and HYPE Card together through a selector on one `/showcase/:inviteToken` link. Keep `/fan/:inviteToken` as the direct route to the full interactive card.

**Why:** The user wants the whole Showcase to be shareable in one place while preserving the standalone HYPE Card experience.

**How to apply:** Match the owner’s current athlete before constructing a Showcase URL or loading its card; keep public visibility rules intact and do not replace the card’s existing interactive route.

Recipients must be able to find alert sign-up on the shared Showcase itself, rather than only on the separate HYPE Card page. Reuse the athlete's existing follow consent, and keep pre-event announcements explicitly opt-in and owner-initiated.

**Why:** The user pointed out that recipients could not find a subscription option on the shared Showcase.

**How to apply:** Keep an obvious recipient alert entry alongside shared Events without implying that following automatically enables alerts or scheduled reminders.

The fan card and Athlete Hype Page are photo-first and do not expose video upload, playback, or video-side controls. Preserve older media records and direct share URLs.

**Why:** The user removed video from Hype Cards and athlete profiles while explicitly preserving existing saved media and share records.

**How to apply:** Keep photo features available, omit video from current card/profile UI and copy, and treat removal of historical files or links as separate destructive work requiring explicit approval.

The four-step standalone Hype Card editor is retired. The diagonal “HYPE CARD” label belongs on the new athlete fan card’s photo, not as a reason to reopen the old creator. Existing one-off public shares and historical saved-design bytes remain intact even though the old editor is no longer an active destination.

**Why:** The user explicitly chose the athlete fan card as the new card and asked to remove the old walkthrough path without deleting historical content.

**How to apply:** Route new creation and sharing through the athlete fan card and its manager. Do not restore old editor entry points or delete legacy share links and saved designs during navigation cleanup.

Event Card authoring is save-only: no automatic clipboard copy or standalone Event Card sharing controls. Saved events belong in the Hype Card's Events side, subject to the existing Allow events setting. The Hype Card remains the destination to share.

**Why:** The user explicitly asked to save the Event Card and make it available in the Hype Card, rather than encourage sharing a separate event link.

**How to apply:** Preserve the server persistence that supplies Hype Card Events and reminders; removing link-sharing UI is not permission to remove its backing records, revoke older URLs, or automatically enable event visibility.