---
name: Native local reminder handoff
description: Why local reminders replace a phone's server destination instead of supplementing it.
---

Local reminders and APNs must never independently cover the same iPhone event-day
or one-hour reminder. Selecting local mode replaces only that phone's server destination;
it does not change account-wide consent or any PWA/native ownership binding.

**Why:** APNs and local notification delivery have no shared transactional
acknowledgment or cross-channel deduplication. Merely checking connectivity before
scheduling cannot prevent a queued or in-flight remote alert from repeating.

**How to apply:** Preserve an acknowledged handoff, a bounded in-flight quiet
window, and consumed-alert suppression. Returning to remote delivery must not
replay still-eligible reminders that may have fired locally. Any stronger handoff
must coordinate both delivery channels, not silently register APNs on reconnect.
Permission and physical offline delivery still require Apple device validation.

Per-event tool-availability reminders are local-only and independent of ordinary
event-day/one-hour consent or delivery mode. They do not participate in APNs handoff.

**Why:** The user chose an optional alert when Stats and Live Taps open. This is a
different moment from existing reminders; changing normal alert preferences must
not erase a separate opt-in or create duplicate cross-channel delivery.

**How to apply:** Keep consent, request identities, capacity reservations, and
category cleanup separate. Account lock/clear still cancels private alerts.
Persist consumed attempts conservatively rather than replaying uncertain alerts.

Reminder performance optimizations should cache only transient input signatures,
not notification acceptance or verified authority.

**Why:** Score writes cannot change a future tool opening, but stale OS snapshots
or account authority could falsely confirm an alert or retain a private request.

**How to apply:** Preserve full checks on relevant changes and reset optimizations
on verification/account/download boundaries. Completion and unreadable pending
work remain invalidating inputs even without a server response.
