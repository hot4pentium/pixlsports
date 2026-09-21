---
name: Nested dashboard grid overrides
description: A CSS inheritance hazard when placing a new dashboard hero grid inside the existing desktop dashboard grid.
---

Broad selectors on the dashboard that assign grid rows or columns to data-test sections can also match panels nested inside a new hero grid. Always scope the hero’s direct children and explicitly set both grid-column and grid-row when composing nested dashboard layouts.

**Why:** The existing desktop dashboard rules assigned the next-event section to row 2 even after it was moved into a new two-column hero, leaving a blank upper-right area and pushing the event panel below the athlete panel.

**How to apply:** When a section moves inside a new grid wrapper, inspect all inherited `grid-row` and `grid-column` selectors and override both axes on the wrapper’s direct children.