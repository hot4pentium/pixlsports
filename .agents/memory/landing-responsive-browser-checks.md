---
name: Landing responsive browser checks
description: Assertions for horizontally scrollable landing content across phone and desktop viewports.
---

Responsive browser checks should assert that the document stays within the viewport while allowing a deliberately scrollable ticker to have a wider internal content area. Do not require the document's layout width to equal the viewport because a vertical scrollbar can reduce the reported client width. For dense multi-column cards, also measure each caption's client and scroll widths after animations settle; fixed inner padding can clip otherwise readable text before page-level overflow appears.

**Why:** A six-card landing ticker needs internal horizontal scrolling on narrow screens and can also exceed its desktop content box slightly without causing page-level overflow; exact desktop width assertions misclassified the normal scrollbar as a layout bug.

**How to apply:** Check document and body scroll widths against the viewport, check the ticker's bounds against the viewport, and separately assert its internal scroll width and label/kicker bounds at phone and desktop sizes. For reduced motion, compare computed animation state and geometry before and after a delay. When the narrowest grid exposes caption clipping, reduce only the mobile card inset or gap instead of shrinking readable type.