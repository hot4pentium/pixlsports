---
name: Profile sport precedence
description: Defines which sport sport-specific tools should select for new work versus existing saved work.
---

When a supporter has chosen a profile sport, use it as the only available sport in sport-specific tasks, projects, and publishing flows. Use saved activity to choose a sport only when the profile has no sport.

**Why:** The profile setting represents the athlete's sport and should remove irrelevant choices throughout the supporter experience. Historical games remain stored unchanged even when their sport is not currently available in the tracker UI.

**How to apply:** Tools should read the validated profile sport and hide other sport selectors when it exists. If it is missing, derive the opening sport from recent valid activity or use the documented fallback. Never rewrite stored activity merely because the profile changed.