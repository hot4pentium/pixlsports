---
name: Designer HYPE Card navigation
description: User-approved presentation of the premium card preview's Replies, Stats, Taps, and Events strip.
---

The saved Spotlight preview must use the real HYPE Card navigation bar: a rounded panel with four icon-and-label controls. Render it below the card artwork as a decorative, static version, not as the exported SVG strip. Keep PNG exports to card artwork only and preserve the public card's interactive controls.

**Why:** The user rejected the exported SVG strip because it did not match the real navigation bar shown in their reference.

**How to apply:** Share the real control items and Spotlight styling between the public card and saved preview. In the saved preview, keep the bar aria-hidden and non-interactive so it does not nest buttons inside the card link. Keep exported PNGs free of navigation UI. For Breakout PNGs, calculate above-frame bleed from the cutout's natural dimensions and current placement; the image's aspect ratio changes whether it actually extends beyond the frame.