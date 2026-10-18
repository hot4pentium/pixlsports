---
name: Sharp crop and trim order
description: Avoid Sharp reordering trim before a sprite-sheet extraction.
---

Materialize a cropped sprite into a buffer before trimming its transparent margins.

**Why:** Sharp can run `trim` before `extract` even when chained after it. Later sprite-sheet quadrants then fail with `extract_area: bad extract area` because their coordinates refer to the original sheet.

**How to apply:** When splitting generated product sheets, extract each quadrant first, create a new Sharp pipeline from that crop, then trim and resize it.
