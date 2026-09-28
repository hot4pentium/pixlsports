---
name: Owner event-day announcements
description: Why the athlete Hype Card's event-day sharing flow is manual on Autoscale.
---

The owner sees an event-day sharing reminder upon opening their signed-in dashboard. A separate opted-in owner phone alert may prompt Hype Card publishing one hour before a timed Game On event once scheduled delivery is activated. Neither prompt automatically notifies followers; the owner must deliberately confirm an event announcement, and only followers who separately opted in to pre-event alerts may receive it.

**Why:** The user later chose a one-hour owner publishing nudge even if the Hype Card was already published, but did not authorize automatic follower announcements. Existing planner phone alerts and older follower event-start preferences are separate; reusing either preference would enroll people who never opted into a manual pre-event announcement. The older follower event-start timer must not run from API startup.

**How to apply:** Keep owner publishing pushes separate from follower sends, and do not promise delivery until the scheduler is active. Preserve older follower consent records without promoting them to the newer, default-off pre-event preference. Do not reuse Game Day Live/planner consent for follower announcements.

For manual follower announcements, never hold invitation or follower database locks while waiting for a push service response. **Why:** Slow devices can otherwise serialize a supposedly parallel announcement and delay a follower's opt-out. **How to apply:** Use short transactions for durable per-device claims, eligibility checks, and outcomes, with bounded network work outside them; verify this with multiple deliberately stalled sends and a concurrent preference change.

An interrupted attempt with an unknown push-service outcome must stay distinguishable from a failed attempt, and must not be resent automatically. **Why:** The service may have accepted the notification immediately before a worker stopped, and a resend would violate the one-attempt-per-device promise. **How to apply:** Let owners continue devices not yet claimed while showing uncertain claims separately until a real outcome is recorded; do not turn an old claim into an automatic retry.