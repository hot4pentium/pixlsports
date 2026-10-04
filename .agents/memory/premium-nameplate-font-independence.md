---
name: Premium nameplate font independence
description: Why premium athlete names need font-independent advance bounds and separate vertical checks.
---

Premium athlete-name fitting must not depend solely on a character-count estimate or the currently loaded browser font. Keep the full name and bound each line independently in the native artwork rather than clipping the card or changing the Hub layout.

**Why:** Wrapped hyphenated names overflowed even though the estimated size fit. Standalone SVG images used for PNG exports can substitute fonts independently of the live page. Horizontal fitting also does not guarantee a wrapped line stays vertically inside a fixed plate with a team label.

**How to apply:** Check live text layout and isolated rasterized name pixels in exports, including foreground-only artwork. Preserve native artwork proportions and intentional cutout spillover; solve typography within the existing plate.