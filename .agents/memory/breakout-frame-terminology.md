---
name: Breakout frame terminology
description: Distinguish the unwanted blue wrapper from the metallic card outline in user requests.
---

Keep the silver outline as the only outer frame on Breakout cards. Remove the dark-blue and light-blue frame layers behind it; preserve the card interior and navigation below.

**Why:** The user clarified with an annotated screenshot that the silver outline is the intended frame and explicitly rejected the two colored frames behind it.

Keep the entire resized avatar visible when it extends outside the silver frame.

**Why:** The user explicitly requested that resizing not cut off the top of the avatar.

Place the photo/avatar layer above the frame layer, including the frame labels.

**Why:** The user explicitly requested that the photo layer overlap the frame layer.

The Breakout name plate is fixed in the lower gap, centered between the stadium background's bottom and card bottom, and paints above the avatar. Premium avatar scaling tops out at 120%, with preview space reserved for its upper spillover.

**Why:** The user supplied visual references, removed name-plate positioning, set 120% as the avatar-size limit, asked for room below the manager cards for the largest cutout, and placed avatar positioning first after design choice.

**How to apply:** Ignore legacy Breakout name-plate offsets when rendering. Keep the plate after the avatar in SVG paint order. Cap size controls, normalized settings, artwork, and PNG exports at 120%; reserve the measured avatar overhang plus a clear gap in the editor preview. Give the preview full phone width and place the compact design picker below it. Keep avatar-positioning controls immediately after the design picker, ahead of identity and style options. Remove surrounding presentation backdrops, including nested flip-face backgrounds, and keep the card interior inside the silver outline. Verify overflow on every saved-card ancestor, not just the SVG: later base styles can override an equally specific premium-face rule. Preserve the artwork, photo window, and below-card navigation.