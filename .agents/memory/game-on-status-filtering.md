---
name: Game On status filtering
description: Preserve unsaved Game On card editor state when supporters filter the collection.
---

When filtering the Game On collection, keep cards mounted and hide nonmatches instead of removing them from the React tree.

**Why:** The inline card editor owns unsaved form and checklist state. Unmounting a selected card when a filter changes can silently discard that work.

**How to apply:** Keep filter counts and accessibility based on matching cards, while applying `hidden` to nonmatching card elements and the full grid when no cards match.