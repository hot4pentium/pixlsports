---
name: Fixed paired-card content
description: Layout constraints for readable content inside equal-sized phone cards.
---

Keep required event titles from flex-shrinking inside fixed 3:4 cards. If dense content exceeds the available height, reduce internal spacing and typography at narrow widths rather than changing the equal dimensions of the paired cards.

**Why:** In a 320px Supporter Hub viewport, the title collapsed to zero height while the action remained visible, despite the cards staying equal.

**How to apply:** When adding content to a fixed-size paired card, test actual rendered text bounds and overflow at the narrowest supported phone width, then verify keyboard focus remains visible.
