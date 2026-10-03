---
name: Hype Card watermark legibility
description: Visual check for translucent branding on small card previews.
---

Treat the phone-sized athlete fan card as a primary readability target for its diagonal photo label, not just the original full-resolution graphic.

**Why:** An initially small, low-opacity watermark passed geometry and raster checks but looked too faint when a card was displayed around 320 pixels wide. The live preview revealed the problem that markup tests missed. Also, Chromium's raw text bounds can extend slightly beyond a clip even when the rendered pixels are correctly clipped. The standalone editor has since been retired.

**How to apply:** When adjusting the fan card's label typography or contrast, inspect its photo at phone width. Check light and dark media, keep the label clipped to the photo area, and preserve enough transparency to leave the athlete visible. In browser tests, verify the clip path and raster output; allow small font-metric tolerances on raw text bounds.