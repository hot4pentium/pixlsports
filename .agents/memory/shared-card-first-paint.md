---
name: Shared HYPE Card first paint
description: Recipient links must avoid PWA chrome and repeated blank-card loading stages.
---

Recipients should see one stable, card-only opening state before the real HYPE Card is ready, not the PWA landing page or successive blank-card layouts.

**Why:** The user said the PWA introduction felt like a different app and later reported multiple blank cards flashing before the athlete's card appeared.

The user confirmed the plain-white PIXL logo splash looked great after it replaced the recipient loading states. Preserve this approved opening treatment.

**How to apply:** The user requested the PIXL logo splash on plain white until the recipient card is ready. Use the same splash across startup, lazy-route, data, and initial-photo waiting states, not card-shaped skeletons. Matching skeleton designs still flashed on the user's iPhone. Once a card is visible, background photo refreshes must not hide it again. Preserve unavailable-link and photo-failure recovery.
