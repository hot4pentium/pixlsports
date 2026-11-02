---
name: Native local reminder handoff
description: Why local reminders replace a phone's server destination instead of supplementing it.
---

Local reminders and APNs must never independently cover the same iPhone event
reminder. Selecting local mode replaces only that phone's server destination;
it does not change account-wide consent or any PWA/native ownership binding.

**Why:** APNs and local notification delivery have no shared transactional
acknowledgment or cross-channel deduplication. Merely checking connectivity before
scheduling cannot prevent a queued or in-flight remote alert from repeating.

**How to apply:** Preserve an acknowledged handoff, a bounded in-flight quiet
window, and consumed-alert suppression. Returning to remote delivery must not
replay still-eligible reminders that may have fired locally. Any stronger handoff
must coordinate both delivery channels, not silently register APNs on reconnect.
Permission and physical offline delivery still require Apple device validation.
