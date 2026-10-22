---
name: Event Card terminology
description: Product-facing terminology and weekly interaction model for Event Cards, with the compatibility boundary around it.
---

Use “Event Card” or “Event Cards” in user-visible copy for the shared game and practice card feature, including dashboard, public-card, HYPE Card event-list, reminder, and API error text. Keep existing Game On identifiers, routes, saved keys, and API contract values unchanged.

**Why:** Event Card is the product-facing name, while Game On remains part of established routes and technical contracts that existing shares and clients depend on.

**How to apply:** When changing copy near Game On card code, update only presentation strings. Search both frontend and API/notification code, and leave identifiers and persisted contract values intact.

The user-facing product has Event Cards, not a Calendar. Event Cards are the entry point for the user's week, and opening one should make the next useful action clear.

**Why:** The user explicitly described Event Cards as the key to what a user can do during the week and corrected language that implied a Calendar product.

**How to apply:** Frame navigation, labels, and next-action guidance around the selected Event Card and its current stage. Do not introduce a Calendar concept unless the user reverses this decision.