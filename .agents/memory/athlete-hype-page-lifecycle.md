---
name: Athlete fan card and Hype Page lifecycle
description: Primary fan-card sharing, preserved original pages, pause/resume behavior, and live-session boundaries.
---

The living athlete fan card is the primary supporter-facing destination. The original Athlete Hype Page remains a separate, usable experience at its existing URL; both are backed by the same durable athlete identity, and season dates provide context rather than expiring the URL. Pausing hides public access until the owner resumes it and revokes any attached Game Day Live session. Game Day Live is optional and short-lived, and stopping it returns the card to finalized stats.

Owner management belongs on its own owner-only route reached from the stable Hype Page, not embedded in the public page and not isolated behind a studio-only entry point. The public page may reveal only the management link after matching the route token against the authenticated account's protected invite list; the management route repeats that ownership check and server mutations still enforce ownership.

**Why:** The user chose the photo-first card as the main fan interface without replacing the original Hype Page or the separate temporary live experience.

**How to apply:** Share the card URL first, preserve the original page and legacy one-off share URLs, and keep the athlete token stable across pause/resume. Let only the owner load a paused page. A public card may show a view-only live scoreboard but must not expose the reusable live-session token or raw tracker events; treat the live session as an independently revocable attachment rather than replacing either durable experience.