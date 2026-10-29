---
name: Public Showcase text reflow
description: Layout constraints needed for the public Showcase unavailable state at enlarged text sizes.
---

At large text sizes, the public unavailable panel must keep its state grid track constrained with `minmax(0, 1fr)`, use border-box sizing for the padded page and panel, and allow heading words to break. Give the large heading enough line height for its glyph bounds.

**Why:** A 200% text check exposed both a grid min-content width escape and heading words/clipped glyphs that remained hidden by the page's overflow rules.

**How to apply:** When changing this error state or its type scale, verify actual text fragment bounds and document width at phone and desktop viewports; do not rely on the panel's outer overflow behavior.
