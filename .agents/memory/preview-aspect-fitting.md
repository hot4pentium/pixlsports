---
name: Preview aspect fitting
description: Responsive sizing rule for expanded card previews with multiple output ratios.
---

Expanded card previews must calculate rendered width and height from the preview stage's measured content bounds, choosing whichever axis limits the selected output ratio.

**Why:** Width-only viewport formulas clipped vertical cards, while CSS height plus max-width constraints could distort landscape cards on narrow screens instead of preserving their ratio.

**How to apply:** When changing expanded-preview layout, verify both portrait and landscape formats in wide and narrow viewports. Assert the rendered bounds stay within the stage and the measured ratio matches the output dimensions.