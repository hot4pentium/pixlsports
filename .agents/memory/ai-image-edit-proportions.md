---
name: AI image edit proportions
description: Check whether an AI-edited image preserved its source aspect ratio before integrating it into responsive UI.
---

AI image edits can change the source image's aspect ratio even when asked to preserve its composition. Verify the output dimensions before replacing artwork used in a fixed-ratio UI; for precise label changes, a programmatic overlay may be safer than regenerating the image. If baked-in text cannot be removed cleanly, keep the new label editable and recreate only the artwork after the user accepts any photo changes. Generated art may ignore the requested ratio, so crop and inspect subject framing before integration.

**Why:** editing a portrait Hype Card produced a square image, which would have disrupted the card framing on the landing page; recreating the artwork also changed the athlete photo.

**How to apply:** compare source and output dimensions, preserve the target crop, and preview the actual responsive UI before wiring an edited image into a component.