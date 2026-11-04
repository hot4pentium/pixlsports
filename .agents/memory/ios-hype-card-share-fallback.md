---
name: iOS HYPE Card share fallback
description: Canonical HYPE Card links open the native iOS app when available and otherwise show a card-only browser fallback.
---

New HYPE Card share and QR links use `/fan/:inviteToken`, the existing iOS Universal Link route. When the app is unavailable, the browser fallback should display the HYPE Card directly without PIXL website branding or a “Back to Player Showcase” action. Keep legacy `/showcase/:inviteToken` links working with the same card-only experience.

**Why:** The user chose native-app sharing with a web fallback; the extra website shell and Showcase navigation confused recipients.

**How to apply:** Keep new link generation aligned with `/fan`, preserve the existing public access and privacy checks, and do not add a website landing layer around shared cards.
