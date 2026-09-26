---
name: Hype manager task drafts
description: Preserve unfinished owner management work while moving between compact task cards.
---

Keep the Hype Card Manager's task panels mounted when switching cards, and keep the visibility/time-zone draft independent of server refreshes until the owner saves or changes athletes.

**Why:** Photo and video uploads hold device-local file and trim state. Posting media, replacing a photo, or pausing the page refreshes the owner record; resetting all visibility controls from that record during an unfinished edit silently discards the owner's changes. Pausing must not implicitly save those unfinished visibility changes either.

**How to apply:** New manager actions may hide panels, but should not remount them; server refreshes must not overwrite a dirty draft. Save the visibility controls together, while availability-only actions use persisted values.