---
name: Simple tracker end state
description: How the inline Game On tracker pauses and completes device-local games without losing or duplicating sessions.
---

The inline Game On tracker treats Pause as a persisted active session and End as a confirmed local-history completion; reopening a completed event should not auto-create a fresh session.

**Why:** The compact tracker intentionally captures locally, while the full tracker provides review and sync. Clearing active state alone would strand the stats, and unconditional creation on reopen can make an ended game look live again.

**How to apply:** When changing inline completion, save the finalized session to tracker history before clearing active storage, keep a deliberate "Start another tracker" path, and preserve visible pause/resume/end controls.