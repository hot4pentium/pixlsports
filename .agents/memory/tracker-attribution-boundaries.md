---
name: Tracker attribution boundaries
description: Product rules for football possession and recipient scoreboard and snapshot identity.
---

Football possession selects the athlete team or opponent for subsequent stat taps. Opponent plays must not count toward athlete or athlete-team totals.

The recipient's live scoreboard names the home team, not the athlete. Show specifically athlete-assigned stats separately from combined team totals.

**Why:** The user asked to use the same football stat controls for either side, and separately asked for the recipient page to show the team as its home name and the athlete's recorded stats in snapshots.

**How to apply:** Preserve explicit side and athlete attribution through saves and sharing. Aggregate athlete snapshots from the full game before limiting the public recent-activity feed; never infer athlete totals from combined team stats. Older shares lacking full totals should identify recent-only athlete data honestly.

Athlete and Team tracking need visibly distinct modes, not just a small attribution
toggle. Reinforce mode with its name, owner, icon and matching stat-tile treatment.
Keep the shared team scoreboard explicit; visual switching must not rewrite
existing attribution or confuse opponent statistics with the athlete.

**Why:** The user said the athlete and team trackers need different looks so users
know which one they are on.

**How to apply:** Preserve this distinction when restyling the full tracker and
keep its non-color cues available to VoiceOver and color-blind users.

Team stat tiles must omit the athlete's individual count, including their spoken
values. In the full tracker, keep Pause/Resume beside LIVE/PAUSED and period
advance beside the current half, set, inning or quarter at the top.

**Why:** The user requested these exact simplifications and control positions.

**How to apply:** Keep athlete-only counts in Athlete mode and preserve shared
team totals and existing pause/advance command safeguards.

A scoring play entered for the athlete must also add its points to the team
score once. For example, one athlete touchdown is one athlete touchdown and six
team points, not a second Team-mode tap.

**Why:** The user explicitly clarified that points should apply to the overall
score regardless of whether the Athlete or Team increment was used.

**How to apply:** Treat attribution and score contribution as separate concerns;
check both server and offline projection, undo, legacy-event compatibility and
retry idempotency. Do not preserve the older athlete-score-exclusion behavior as
the intended product rule.
