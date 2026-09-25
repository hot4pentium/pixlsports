---
name: Simple tracker end state
description: How the inline Game On tracker pauses and completes device-local games without losing or duplicating sessions.
---

The inline Game On tracker treats Pause as a persisted active session and End as a confirmed local-history completion; reopening a completed event should not auto-create a fresh session. When the tracker is linked to a Calendar game, End also persists that event as final with a completion timestamp through the schedule’s owner-write path.

**Why:** The compact tracker intentionally captures locally, while the full tracker provides review and sync. Calendar status is separate from tracker history, so saving the final stats alone left the badge and dashboard marked Live.

**How to apply:** When changing inline completion, save the finalized session to tracker history before clearing active storage, find the linked Calendar game across saved schedules rather than assuming the currently visible schedule owns it, persist its status with `completedAt`, update the writer’s schedule cache, and offer a retry if schedule sync fails. A standalone published card has no Calendar owner; its badge can reflect the completed tracker on this device without inventing a Calendar entry. Keep a deliberate "Start another tracker" path and preserve visible pause/resume/end controls.

**Why:** Published cards can outlive a selected schedule or be independent of Calendar entirely. Treating every card as part of the active Calendar produces a false save error before any request is sent.