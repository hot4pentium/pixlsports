---
name: Profile sport precedence
description: Defines which sport sport-specific tools should select for new work versus existing saved work.
---

When a supporter has chosen a profile sport, use it as the only available sport in sport-specific tasks, projects, and publishing flows. If the profile has no sport, use the latest valid tracker history; when there is no history, require a tracker-only sport choice before creating a game. Do not save that choice to the profile.

**Why:** The profile setting represents the athlete's sport and should remove irrelevant choices throughout the supporter experience. History provides continuity only when the profile is unset; silently defaulting an account with no sport or history can create a game with the wrong sport.

**How to apply:** Tools should read the validated profile sport and hide other sport selectors when it exists. Otherwise use recent valid activity, or ask for a sport in the tracker before creating a game. Restore an in-progress session from its saved sport, keep the choice local to tracking, and never rewrite existing activity.