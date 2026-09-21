---
name: Athlete Hype Page lifecycle
description: Durable athlete pages, pause/resume behavior, and optional live-session boundaries.
---

The athlete Hype Page is the account-lifetime sharing destination; season dates provide context and must not expire its URL. Pausing hides the same page token and revokes any attached Game Day Live session. Game Day Live is optional and short-lived, and stopping it returns the page to finalized stats.

**Why:** The product needs one stable link for evolving athlete updates while keeping live tracker activity temporary and owner-controlled.

**How to apply:** Preserve the page token across pause/resume, keep legacy share URLs working, and treat the live-session token as an independently revocable attachment rather than replacing the durable page.