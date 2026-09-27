---
name: Checklist owner and shared-link consistency
description: Product expectation for edits made from either checklist entry point.
---

Once a checklist has an edit link, edits made on the owner's Game On card (or an older owner link) and on the shared page should update the same shared checklist. Notes and checked items follow the same rule. A debounced shared edit must remain recoverable across card close/reopen until the server confirms it.

The Game On card's inline Prep list is the only owner-facing Prep editor. Do not add a second “full Prep checklist” action to the card. Preserve old standalone URLs for existing links and the shared edit page for collaborators.

**Why:** The owner previously saw local edits on their regular page while collaborators continued to see an older shared version, with no Update button to explain the difference. Closing a card during the debounce window could similarly leave a local edit that a fresh shared fetch would silently replace.

**How to apply:** When adding checklist fields or editing flows, preserve autosave from both entry points, retain an unsynced snapshot until confirmation, and make failed shared saves visible rather than treating local persistence as a successful share.

**Why:** The user explicitly prefers one Prep list on the Game On card instead of another full checklist page in the main workflow.

**How to apply:** Put new owner Prep controls inside the card; maintain the older route only as compatibility, not as a promoted navigation destination.