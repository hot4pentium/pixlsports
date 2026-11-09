# Reminder work during live scoring

## Baseline characterization

Before changing the routing, the runtime unconditionally started availability
reconciliation from every `storageChanged()` and both reminder coordinators
from every `cache()` call. Availability rebuilt contexts for all active selections
and queried notification settings and pending requests on each completed pass.

An isolated-turn call-count model of **40 score entries**, **eight selected future
games**, and **one pending write plus one workspace response per entry** produced:

| Work | Before | Warm optimized path |
| --- | ---: | ---: |
| Availability rebuilds | 80 | 0 |
| Selected future-workspace reads | 640 | 0 |
| Availability settings queries | 80 | 0 |
| Availability pending-request queries | 80 | 0 |
| Routine reminder rebuilds | 40 | 0 |

This is a deterministic call-path characterization, **not** a CPU benchmark or
physical-device/OS measurement. It excludes additional attempted/acknowledgement
queue writes; those previously also requested availability reconciliation.
Overlapping old passes could be interrupted/coalesced, while isolated completed
passes incurred the counts above.

## Executable bounds

Run from the project root:

```sh
bash ios/Tests/verify-reminder-invalidation.sh
```

On this Linux workspace, provide the installed compiler explicitly if it is not
on PATH:

```sh
SWIFTC=/nix/store/vfh0ykchqadjb9kdnlmppp0rc3r1b2a9-swift-5.8/bin/swiftc \
  bash ios/Tests/verify-reminder-invalidation.sh
```

The standard-library Swift checks execute the **production invalidation policy**,
not a JavaScript rewrite. They prove zero invalidations after warm-up for a
40-entry burst, including acknowledgement/projection inputs and unrelated profile
cache updates. Before warm-up, the burst allows at most one routine invalidation
and two availability invalidations (workspace and tool state), independent of the
number of score entries. Availability also filters unselected event tokens and
coalesces accepted invalidations before rebuilding.

These are bounds on score-caused work only. Explicit opt-ins, schedule refreshes,
verified lease refreshes, notification-settings changes, and other relevant
changes still intentionally rebuild. A new verification or download removal
resets the transient optimization.

Source regression checks connect the policy to runtime caching and durable queue
writes, ensure Final invalidates before projection, require synchronous request
cancellation/account fencing, and preserve consent, consumed-attempt suppression,
capacity and OS-accepted confirmation paths. They are not a substitute for an
Apple SDK type check or OS execution.

## Debug counters on an iPhone

Both coordinators expose `workCounts` in DEBUG builds. These increment at the
actual rebuild, selected-workspace read, settings query, pending-request query,
and OS-add sites. They contain no account IDs or event content.

1. Prepare eight future games and explicitly opt into their tool reminders.
   Also enable ordinary local reminders if measuring both categories.
2. Open the current game's tracker and let initial preparation/reconciliation
   finish. Reset both coordinators' `workCounts` to `NativeReminderWorkCounts()`
   in the debugger.
3. Enter 40 stats, offline and then online, allowing acknowledgements to settle.
   Without other input changes, all five counters should remain zero. Capture
   Instruments main-thread time separately; no timing threshold is claimed by
   the deterministic tests.
4. Change a selected future kickoff/time zone, delete a selected card, queue an
   offline Final, and discard a pending time edit. Each must re-evaluate rather
   than hit the score-only fast path. Inspect request removal before the next
   async rebuild. Exercise an OS add interrupted by these changes.
5. Renew or expire the verified lease and switch accounts while an OS operation
   is suspended. The old operation must not publish confirmation or retain a
   request. Denied permissions and a failed OS add must not say “saved.”
6. Let an attempted fire time pass and postpone the event. No new alert may be
   armed without explicit opt-in, even if the old delivery was uncertain.

Apple SDK build, Instruments measurements, notification permission and actual
delivery remain Apple-device checks. No web preview can validate those.
