---
name: Local video preparation
description: Product decision for source-video limits, local compression, trimming, and privacy.
---

Accept source videos up to 120MB, prepare a smaller MP4 locally when the browser supports it, and let users select a segment of no more than 15 seconds for preview and export.

**Why:** Larger phone videos should be accepted without sending youth-sports media to the server, while smaller working files reduce mobile storage and export failures.

**How to apply:** Keep original and converted video bytes on-device only. Save trim settings as part of the design. If local MP4 conversion is unavailable, retain the original local clip and explain the fallback.