---
name: Shared HYPE Card first paint
description: Recipient links must avoid PWA chrome and repeated blank-card loading stages.
---

Recipients should see one stable, card-only opening state before the real HYPE Card is ready, not the PWA landing page or successive blank-card layouts.

**Why:** The user said the PWA introduction felt like a different app and later reported multiple blank cards flashing before the athlete's card appeared.

**How to apply:** Keep startup, lazy-route, data, and initial-photo waiting states visually consistent. Preserve unavailable-link and photo-failure recovery instead of hiding failures or leaving recipients waiting indefinitely.
