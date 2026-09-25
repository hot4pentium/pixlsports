---
name: Game On badge panel focus
description: Focus and draft-preservation rules for switching between the badge's faces.
---

When Details opens Prep or Stat Tracker, closing that tool should return to the badge front and focus the matching visible front action, not the shortcut inside Details. Keep the Details editor mounted but hidden while switching faces so unsaved fields survive.

**Why:** The shortcut on the back is hidden when the badge returns to its front, so restoring focus there fails. Unmounting Details during another flip silently discards fields that have not been saved.

**How to apply:** For new in-badge shortcuts and panels, map return focus to a visible front control and preserve in-progress editor state across face changes. Clear an open panel when its selected badge is no longer selected.