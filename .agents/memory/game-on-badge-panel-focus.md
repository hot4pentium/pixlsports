---
name: Game On card focus boundaries
description: Modal, compact-grid, focus, and draft-preservation rules for Game On card interactions.
---

When a focused Game On card is shown in a modal, only the modal card should receive its open panel state. Keep the compact grid tile's panel closed; otherwise Prep or Stat Tracker mounts twice, the grid can expand, and the hidden instance can steal focus. When Details opens Prep or Stat Tracker, closing that tool should return to the badge front and focus the matching visible front action, not the shortcut inside Details. Keep the Details editor mounted but hidden while switching faces so unsaved fields survive.

**Why:** A modal and its compact grid tile represent the same card at once. Mirroring panel state into both creates duplicate interactive trackers and can direct focus into the obscured tile. The shortcut on the back is hidden when the badge returns to its front, so restoring focus there also fails. Unmounting Details during another flip silently discards fields that have not been saved.

**How to apply:** Route panel state only to the active modal card; keep grid tiles compact and noninteractive beyond opening the card. For new shortcuts and panels, map return focus to a visible front control and preserve in-progress editor state across face changes. Clear an open panel when its selected badge is no longer selected.

The Supporter Hub Event Card uses its right arrow to enter event editing and a “Back to Event Card” control to return. Do not restore separate Details, Copy Link, or Open Card action tiles. Keep Stat Tracker neutral before selection.

**Why:** The user explicitly requested these dashboard controls to be simplified. This request concerns the opened dashboard Event Card, not the separate post-save confirmation.

**How to apply:** Preserve the event's date, time, and location facts, retain Share and its clipboard fallback, and restore editor-return focus to the visible edit arrow.

On completed Event Cards, keep Prep, Stat Tracker, and Share neutral by default; the completed status should not make an action look selected.

**Why:** The user asked for neutral action choices when an event is finished.

**How to apply:** Keep default action surfaces neutral across Event Card states. Preserve clear hover, focus, and explicitly opened-panel states.

After creating an Event Card from the Supporter Hub Message Board, open the saved card and announce that it was created.

**Why:** The user said returning without seeing the card makes it unclear that creation succeeded.

**How to apply:** After a successful new-card save, select the saved card in the collection and keep a clear creation message available to assistive technology.