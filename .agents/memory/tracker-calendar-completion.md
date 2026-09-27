---
name: Tracker Calendar completion
description: How a compact tracker should handle a saved final when Calendar status synchronization fails.
---

A compact tracker may finish saving stats before Calendar accepts the corresponding Final status. Do not show a successful dashboard completion handoff until that Calendar update succeeds. Keep failed updates account-scoped and recoverable from the dashboard as well as the open tracker.

**Why:** Navigating away from the inline tracker immediately after starting an asynchronous Calendar update hides its retry control on failure, leaving the scheduled game incorrectly marked non-final.

**How to apply:** Wait for Calendar confirmation before dispatching the completion handoff. If confirmation fails, preserve a pending update that survives closing the card panel, show a visible retry action, and clear it only after Calendar accepts the Final status.