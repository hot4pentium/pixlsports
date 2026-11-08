---
name: Native Prep autosave
description: Native checklist task changes save automatically, while event notes use explicit Save Prep.
---

Native Prep task additions, removals, and checkoffs should autosave after a short debounce. Keep event-note edits on the explicit Save Prep action. Routine online save feedback must stay in a fixed-height footer; reserve the larger status panel for offline or error states.

**Why:** The user reported that a newly added task’s completion reverted after reloading; a separate save tap made task completion easy to miss. They also reported a screen jolt on each tap because the routine save notice changed the checklist layout.

**How to apply:** Save the complete checklist through the shared event-workspace command after a short debounce, flush a pending autosave when the app backgrounds, preserve the retryable on-device queue, and show pending or failed saves clearly. Do not replay completion celebrations when restoring saved state.

Long-press Edit and Delete belong directly on the main Prep checkoff rows, not
only in Manage. Editing there should stay on the main screen.

**Why:** The user found the extra management screen confusing and explicitly said
the screen where tasks are checked off is where edit/delete should happen.

**How to apply:** Keep task identity and completion unchanged when renaming, and
reuse the checklist autosave path for changes. Manage can remain for adding tasks
and editing event notes.
