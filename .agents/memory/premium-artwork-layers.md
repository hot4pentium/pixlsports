---
name: Premium artwork layer resources
description: SVG resource definitions for premium card background, foreground, and composed rendering modes.
---

Every premium card art layer must define the SVG gradients, clips, and filters it references. A preview of the combined card is not enough validation.

**Why:** The owner editor and export paths request background and foreground SVGs separately; a resource declared only in the opposite layer breaks those render modes while the combined preview may still look correct.

**How to apply:** Keep each layer self-contained and test `bg`, `fg`, and `all` for every premium design.

Use Anton with a light outline for Spotlight's large background jersey number only; center it vertically between the card top and the name block, keep the avatar above it, and leave name typography and other templates unchanged.

**Why:** The user confirmed the outlined Anton number looks much better and clarified that centering means between the card top and the name block, not within the full card.

**How to apply:** Maintain preview/export font parity and ensure PNGs embed the number font rather than depending on an external font request.

Keep the area outside Spotlight's rounded glowing frame transparent, without a blue rectangular backing.

**Why:** The user requested removal of the blue rectangle behind Spotlight while retaining the card.

**How to apply:** Preserve the interior artwork, glow, and avatar spillover; inspect the live card wrappers as well as its SVG.

Allow owners to choose a preset backdrop behind background-removed athletes instead of requiring the automatic sport backdrop.

**Why:** The user reported that the default venue did not match the athlete’s sport and supplied alternate background artwork for selection.

**How to apply:** Keep a sport-matched default available, preserve the original photo, and carry the chosen backdrop consistently through the editor, shared card, and exports.