---
name: Checklist owner and shared-link consistency
description: Product expectation for edits made from either checklist entry point.
---

Once a checklist has an edit link, edits made on the owner's regular checklist and on the shared page should update the same shared checklist. Notes and checked items follow the same rule.

**Why:** The owner previously saw local edits on their regular page while collaborators continued to see an older shared version, with no Update button to explain the difference.

**How to apply:** When adding checklist fields or editing flows, preserve autosave from both entry points and make failed shared saves visible rather than treating local persistence as a successful share.