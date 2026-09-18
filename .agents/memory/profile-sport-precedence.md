---
name: Profile sport precedence
description: Defines which sport sport-specific tools should select for new work versus existing saved work.
---

Use the sport chosen in the supporter profile as the default for new sport-specific tasks, projects, and publishing flows. When reopening existing work, its saved sport or most recent valid activity sport takes precedence.

**Why:** The profile choice should remove repeated setup, but changing a profile must not silently reinterpret or mutate historical projects that were created for another sport.

**How to apply:** New tools should read the validated profile sport and fall back to their documented default only when it is missing. Restore an existing project’s own sport before applying the profile default, and never rewrite stored activity merely because the profile changed.