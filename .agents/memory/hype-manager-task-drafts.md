---
name: Hype manager task drafts
description: Preserve unfinished owner management work while moving between compact task cards.
---

Keep the Hype Card Manager's task panels mounted when switching cards. Visibility switches now save immediately; keep any unfinished time-zone edit independent of those saves and of server refreshes until the owner saves it or changes athletes.

**Why:** Photo and video uploads hold device-local file and trim state. Posting media, replacing a photo, pausing, or saving one visibility switch refreshes the owner record; resetting the time-zone draft from that record silently discards typed work. Pausing and visibility autosaves must not implicitly save an unfinished time zone.

**How to apply:** New manager actions may hide panels, but should not remount them; server refreshes must not overwrite a dirty time-zone draft. Visibility switch saves use the persisted time zone, not the typed draft. Availability-only actions use persisted settings.