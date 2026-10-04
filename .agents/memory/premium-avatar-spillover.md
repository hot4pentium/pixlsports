---
name: Premium avatar spillover
description: Prevent enlarged or repositioned premium HYPE Card cutouts from being cropped in live cards and PNG exports.
---

Premium HYPE Card cutouts may extend above their frame. Live rendering needs visible overflow on the SVG root and every enclosing HTML wrapper; setting overflow only on the inner SVG is insufficient if a premium-face wrapper remains hidden. PNG rasterization clips at the SVG viewBox regardless of overflow, so export must expand the viewBox using the fitted image bounds, scale, and vertical position.

**Why:** A Gallery cutout could have an SVG overflow of `visible` and still be clipped by the live premium-face wrapper; PNG export also cropped spillover that remained visible in HTML.

**How to apply:** When changing premium avatar placement or scale, test transformed image bounds against the SVG and inspect computed overflow through the live card's ancestor chain. Add PNG export assertions for each affected template using portrait cutouts and maximum scale/offset.