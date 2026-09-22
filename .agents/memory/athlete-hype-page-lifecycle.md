---
name: Athlete Hype Page lifecycle
description: Durable athlete pages, pause/resume behavior, and optional live-session boundaries.
---

The athlete Hype Page is the account-lifetime sharing destination; season dates provide context and must not expire its URL. Pausing hides the same page token from visitors and revokes any attached Game Day Live session, while the authenticated owner must retain access so they can manage or resume it. Game Day Live is optional and short-lived, and stopping it returns the page to finalized stats.

Owner management belongs on its own owner-only route reached from the stable Hype Page, not embedded in the public page and not isolated behind a studio-only entry point. The public page may reveal only the management link after matching the route token against the authenticated account's protected invite list; the management route repeats that ownership check and server mutations still enforce ownership.

**Why:** The product needs one stable link for viewing and managing evolving athlete updates while keeping owner tools private and live tracker activity temporary.

**How to apply:** Preserve the page token across pause/resume, let only its owner load a paused page, keep legacy share URLs working, and treat the live-session token as an independently revocable attachment rather than replacing the durable page.