---
name: Dashboard and Showcase navigation
description: Dashboard HYPE Card previews are non-clickable; viewing and editing belong in Player Showcase.
---

The dashboard HYPE Card image is a non-clickable preview on both mobile and desktop. Users should go through the Player Showcase tab to view, edit, and manage the HYPE Card. Keep public sharing separate from private owner navigation, and preserve the Showcase return link to Supporter Hub.

**Why:** The user said there were too many HYPE Card entry points and explicitly replaced the earlier dashboard-card navigation request.

**How to apply:** Do not add a link, button role, keyboard tab stop, or card-opening handler to the dashboard artwork. Direct card-management guidance to Player Showcase.

When the owner opens the public HYPE Card from Player Showcase, its back button must return to the private Player Showcase, not the separate public Showcase card view. Public recipients retain a public return destination.

**Why:** The user reported being sent to a different HYPE Card view instead of returning to the Showcase page.

**How to apply:** Preserve the owner entry context while ownership loads, and distinguish verified owners from ordinary recipients when resolving the card's back button.

The desktop card-design editor should follow the mobile sequence: card with its four content buttons, frame and lower-third arrows, then photo-position sliders.

**Why:** The user requested the same mobile-style design layout on desktop rather than a side-by-side card and large template gallery.

**How to apply:** Keep the single-column editor bounded and centered, and use the same arrow controls on both desktop and mobile.
