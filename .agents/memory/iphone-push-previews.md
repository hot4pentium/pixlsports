---
name: iPhone push preview settings
description: Distinguish hidden iOS notification previews from missing push content.
---

When all PIXL push alerts show only a generic label on iPhone, check Settings → Notifications → Show Previews before changing notification payloads. Setting previews to Always made the existing title and body visible.

**Why:** The published app already sent descriptive titles and bodies; the phone's Never setting hid them, including while unlocked. Changing alert code would not have fixed the display.

**How to apply:** Verify preview visibility first. If the generic label remains with previews enabled, then investigate the installed app's active service worker and push subscription.