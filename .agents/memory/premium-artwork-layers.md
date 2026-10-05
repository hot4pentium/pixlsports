---
name: Premium artwork layers and export backgrounds
description: SVG resource definitions and transparent versus JPEG matte behavior for premium cards.
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

**How to apply:** Keep a sport-matched default available, preserve the original photo, and carry the chosen backdrop consistently through the editor, shared card, and exports. On Spotlight, the chosen backdrop belongs inside the inner frame behind the avatar, not only on the outer shell.

Keep live SVG card artwork transparent outside the rounded frame, but flatten premium phone-save JPEG exports onto black.

**Why:** The user wants HYPE Card exports to save as JPEGs to phone Photos and chose black rather than white for the areas JPEG cannot leave transparent.

**How to apply:** Fill the JPEG export canvas black before drawing the card artwork. Do not add that matte to the live preview or SVG source.