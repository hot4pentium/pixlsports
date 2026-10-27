---
name: Fixed paired-card content
description: Layout constraints for readable content inside equal-sized phone cards.
---

Keep required event titles from flex-shrinking inside fixed 3:4 cards. If dense content exceeds the available height, reduce internal spacing and typography at narrow widths rather than changing the equal dimensions of the paired cards.

**Why:** In a 320px Supporter Hub viewport, the title collapsed to zero height while the action remained visible, despite the cards staying equal.

**How to apply:** When adding content to a fixed-size paired card, test actual rendered text bounds and overflow at the narrowest supported phone width, then verify keyboard focus remains visible.

Desktop Event Card message boards need substantially larger titles, labels, dates, and action text than the compact phone pair; do not simply stretch the mobile typography across a larger board.

**Why:** The user repeatedly requested larger message-board text and specifically identified unused desktop space.

**How to apply:** Scope desktop typography to the desktop message board so phone dimensions and legibility fixes remain intact. Check narrow desktop columns and longer event names for clipping.
