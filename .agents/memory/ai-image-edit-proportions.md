---
name: AI image edit proportions
description: Check whether an AI-edited image preserved its source aspect ratio before integrating it into responsive UI.
---

AI image edits can change the source image's aspect ratio even when asked to preserve its composition. Verify the output dimensions before replacing artwork used in a fixed-ratio UI; for precise label changes, a programmatic overlay may be safer than regenerating the image.

**Why:** editing a portrait Hype Card produced a square image, which would have disrupted the card framing on the landing page.

**How to apply:** compare source and output dimensions and preview the actual responsive UI before wiring an edited image into a component.