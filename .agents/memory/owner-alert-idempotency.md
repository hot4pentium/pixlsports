---
name: Owner alert idempotency
description: One-hour owner push deduplication across Game On Card replacement and uncertain delivery.
---

One-hour owner prompts should use a durable key based on owner, event ID, and event date, independent of a particular shared card. When multiple saved cards reference that same event, the most recently updated card controls the reminder time; an older share must not take the claim merely because its earlier time becomes due first. Keep a claimed key after an uncertain process exit rather than risking a second push. Known temporary failures may keep the claim during the one-hour retry window, but if all device attempts were known unsuccessful when that window expires, release it so a capture-open fallback can proceed. Never release it after an accepted or uncertain attempt.

**Why:** The user asked for one reminder per event even when a Hype Card has already been published. Share-scoped delivery history disappears when a card is deleted, so a new share could otherwise repeat a prompt for the same saved event. If both shares remain, a stale card could send first and suppress the correctly timed replacement alert. A known failed attempt must not permanently block the promised post-start fallback.

**How to apply:** Preserve the event-level claim when replacing a share, but allow a changed event date to receive its own alert. Logical duplicates with a new event ID cannot be recognized automatically without a separate event lineage.