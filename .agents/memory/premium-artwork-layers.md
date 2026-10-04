---
name: Premium artwork layer resources
description: SVG resource definitions for premium card background, foreground, and composed rendering modes.
---

Every premium card art layer must define the SVG gradients, clips, and filters it references. A preview of the combined card is not enough validation.

**Why:** The owner editor and export paths request background and foreground SVGs separately; a resource declared only in the opposite layer breaks those render modes while the combined preview may still look correct.

**How to apply:** Keep each layer self-contained and test `bg`, `fg`, and `all` for every premium design.

Use Anton with a light outline for Spotlight's large background jersey number only; center it vertically in the full card, keep the avatar above it, and leave name typography and other templates unchanged.

**Why:** The user confirmed the outlined Anton number looks much better and requested that it be centered vertically in the card.

**How to apply:** Maintain preview/export font parity and ensure PNGs embed the number font rather than depending on an external font request.