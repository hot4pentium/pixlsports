---
name: Native Prep autosave
description: Native checklist task changes save automatically, while event notes use explicit Save Prep.
---

Native Prep task additions, removals, and checkoffs should autosave after a short debounce. Keep event-note edits on the explicit Save Prep action. Routine saving and saved messages must be silent: no text above the checklist or status footer. Reserve visible notices for offline or error states that need attention.

**Why:** The user reported that a newly added task’s completion reverted after reloading; a separate save tap made task completion easy to miss. They also reported a screen jolt on each tap and explicitly said routine saved text is unnecessary: “It just needs to work.”

**How to apply:** Save the complete checklist through the shared event-workspace command after a short debounce, flush a pending autosave when the app backgrounds, preserve the retryable on-device queue, and show pending or failed saves clearly. Do not replay completion celebrations when restoring saved state.

Long-press Edit and Delete belong directly on the main Prep checkoff rows, not
only in Manage. Editing there should stay on the main screen.

**Why:** The user found the extra management screen confusing and explicitly said
the screen where tasks are checked off is where edit/delete should happen.

**How to apply:** Keep task identity and completion unchanged when renaming, and
reuse the checklist autosave path for changes. Manage can remain for adding tasks
and editing event notes.
