---
name: Live Taps offline delivery
description: Native owner and family offline cheers, original-game binding, and undelivered-cheer handling.
---

The user approved offline saving for parent and family Live Taps on iPhone. A game must first be opened with a connection; cached access does not authorize starting a new session offline.

**Why:** Families need to keep cheering when reception drops, without losing taps or accidentally attributing them to another event.

**How to apply:** Save before sending, retry automatically while the app is foregrounded, and preserve the same delivery identity across network failures and relaunches. Do not promise delivery while iOS has suspended or closed the app. Browser fallback is a separate implementation.

Every saved cheer stays attached to its original game and, when opened from an Event Card, that source event. Keep owner queues isolated by verified identity and account-link context. Encrypt family QR credentials; never put them in ordinary preferences.

**Why:** An athlete's shared card can move to a different live game while a phone is offline. Shared athlete identity alone is not proof of the intended event.

**How to apply:** The server must reject rerouting to a different game or Event Card. Ended sessions and revoked grants cannot accept newly delayed cheers. Keep those undelivered cheers visible for attention or deliberate removal rather than silently dropping them.

An already-accepted cheer whose reply was lost must still acknowledge its existing receipt after Live Taps ends. Retrying that receipt is not permission to record a new late cheer.

**Why:** A timeout does not prove the server failed to save the tap. Otherwise reconnecting either duplicates cheers or falsely reports delivered taps as lost.

**How to apply:** Only remove an outbox item after recording confirmation durably. Show confirmed totals separately from locally waiting cheers. Sign-out locks owner queues; explicitly confirmed account removal purges them.
