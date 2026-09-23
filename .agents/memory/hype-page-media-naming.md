---
name: Hype Page media naming
description: Security and compatibility rules for human-readable names on hosted Hype Page media
---

Hosted Hype Page media names are display metadata, not file or storage names. Keep the original device filename private, validate the display value on the server, and provide a safe generic fallback for legacy shares.

**Why:** Existing manifests contain local video metadata and older share titles can include device filenames, so exposing the manifest or title unchanged can leak private implementation details even when a new display-name field exists.

**How to apply:** When adding or changing hosted-media labels, sanitize public titles and API labels, strip `videoMeta.name` from public manifests, and preserve the separate name through owner/public responses and replacement flows.