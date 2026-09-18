---
name: Reply inbox retention
description: Product rule for retaining Hype Card recipient replies in the owner's grouped inbox.
---

Keep replies from recent sent Hype Cards in the owner's inbox even after the public link expires or is revoked.

**Why:** Expiration and revocation should stop new public replies, not remove messages and reactions the owner already received.

**How to apply:** Inbox and read-state queries should use owner identity and recent-send limits rather than active-share filters. Public reply creation must still require an active share.