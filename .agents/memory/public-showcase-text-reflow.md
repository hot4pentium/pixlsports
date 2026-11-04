---
name: Public Showcase text reflow
description: Layout constraints needed for the public Showcase unavailable state at enlarged text sizes.
---

At large text sizes, shared-card unavailable panels must keep a bounded, shrinkable width (`width: min(100%, …)` and `min-width: 0`); grid layouts should use `minmax(0, 1fr)`. Let heading words break, give the large heading enough line height, and allow supporting copy and buttons to wrap.

**Why:** A 200% text check exposed both a grid min-content width escape and heading words/clipped glyphs that remained hidden by the page's overflow rules.

**How to apply:** When changing the shared-card unavailable state or its type scale, verify actual text fragment bounds and document width at phone and desktop viewports; do not rely on the panel's outer overflow behavior.
