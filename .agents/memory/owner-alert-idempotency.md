---
name: Owner alert idempotency
description: One-hour owner push deduplication across Game On Card replacement and uncertain delivery.
---

One-hour owner prompts should use a durable key based on owner, event ID, and event date, independent of a particular shared card. Keep a claimed key after an uncertain process exit rather than risking a second push; release it when a send is known to have failed or eligibility was withdrawn. A post-start capture-open push is a fallback only when the one-hour prompt was not claimed.

**Why:** The user asked for one reminder per event even when a Hype Card has already been published. Share-scoped delivery history disappears when a card is deleted, so a new share could otherwise repeat a prompt for the same saved event.

**How to apply:** Preserve the event-level claim when replacing a share, but allow a changed event date to receive its own alert. Logical duplicates with a new event ID cannot be recognized automatically without a separate event lineage.