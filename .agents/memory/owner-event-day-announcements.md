---
name: Owner event-day announcements
description: Why the athlete Hype Card's event-day sharing flow is manual on Autoscale.
---

The owner sees an event-day sharing reminder only upon opening their signed-in dashboard. Following that reminder never automatically notifies followers; the owner must deliberately confirm an event announcement, and only followers who separately opted in to pre-event alerts may receive it.

**Why:** The user chose to retain the current Autoscale setup rather than add scheduled hosting or promise a timed push while the owner is away. Existing planner phone alerts and older follower event-start preferences are separate; reusing either preference would enroll people who never opted into a manual pre-event announcement. The older follower event-start timer must not run from API startup.

**How to apply:** Keep future event-day Hype Card copy honest about the in-app reminder and manual send. Preserve older consent records without promoting them to the newer, default-off pre-event preference. Do not describe this as an automatic owner push or reuse Game Day Live/planner consent without a new product decision.

For manual follower announcements, never hold invitation or follower database locks while waiting for a push service response. **Why:** Slow devices can otherwise serialize a supposedly parallel announcement and delay a follower's opt-out. **How to apply:** Use short transactions for durable per-device claims, eligibility checks, and outcomes, with bounded network work outside them; verify this with multiple deliberately stalled sends and a concurrent preference change.