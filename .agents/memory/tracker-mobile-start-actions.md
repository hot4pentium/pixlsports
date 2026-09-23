---
name: Tracker mobile start actions
description: Why the scheduled-game notice remains the mobile entry point for manual and scheduled starts.
---

When a scheduled game exists, the mobile Stat Tracker uses the compact next-game notice for both "Use this game" and "Start manual game"; the larger scheduled-game summary is reserved for desktop. Keep the notice available on mobile until a game starts, even if the desktop reminder was dismissed or the scheduled-game setup was opened.

**Why:** Hiding the larger card removes its manual-game trigger. If the notice disappears at the same time, mobile users lose their visible path to start a game or revisit setup.

**How to apply:** When changing the upcoming notice, its dismissal, or the manual setup flow, check that a scheduled-game user can open and complete setup at mobile widths without revealing a redundant scheduled-game card. Preserve the blank-tracker path when no scheduled game exists.