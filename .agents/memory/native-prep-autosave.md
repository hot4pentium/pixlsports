---
name: Native Prep autosave
description: Native checklist task changes save automatically, while event notes use explicit Save Prep.
---

Native Prep task additions, removals, and checkoffs should autosave after a short debounce. Keep event-note edits on the explicit Save Prep action. Routine saving and saved messages must be silent: no text above the checklist or status footer. Reserve visible notices for offline or error states that need attention.

**Why:** The user reported that a newly added task’s completion reverted after reloading; a separate save tap made task completion easy to miss. They also reported a screen jolt on each tap and explicitly said routine saved text is unnecessary: “It just needs to work.”

**How to apply:** Save the complete checklist through the shared event-workspace command after a short debounce, flush a pending autosave when the app backgrounds, preserve the retryable on-device queue, and show actionable save failures clearly without routine pending messages. Do not replay completion celebrations when restoring saved state.

Silence routine checklist-save UI in the entire Event Details container, not just
the Prep child. Autosaved checkoffs are not manually unsaved notes. Only notes,
unfinished editor text, or an actual local persistence failure need manual-leave
protection. Prep-only pending commands must not trigger tracker recovery.

**Why:** The user supplied a recording showing that removing the child footer did
not fix the parent dirty/save banners that shifted the checklist on every tap.

**How to apply:** Verify full-container row positions through debounce and server
acknowledgement. Keep completion feedback in existing space and do not
automatically collapse the final tapped row.

Long-press Edit and Delete belong directly on the main Prep checkoff rows, not
only in Manage. Editing there should stay on the main screen.

**Why:** The user found the extra management screen confusing and explicitly said
the screen where tasks are checked off is where edit/delete should happen.

**How to apply:** Keep task identity and completion unchanged when renaming, and
reuse the checklist autosave path for changes. Manage can remain for adding tasks
and editing event notes.
