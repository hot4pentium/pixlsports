---
name: Hosted video poster capture
description: Why a hosted video can have a black saved poster and how to avoid it.
---

Generate a hosted clip's poster from a decoded frame of the finished, validated video, not from the source video immediately after setting its trim time. Existing black posters require a viewer fallback or backfill; changing future uploads alone does not repair them.

**Why:** A posted clip had clear frames from its first second, but the separately saved JPEG poster was uniformly black. A source seek at the current time can appear complete before a drawable frame is available.

**How to apply:** Capture at a nonzero time after decoding the finalized clip, detect near-blank stills before settling on a thumbnail, and keep old video shares intact while recovering their display.

Media seeks tested with headless Chromium's accelerated virtual-time budget can falsely time out while real-time browser navigation succeeds.

**Why:** Virtual timers advanced ahead of network and decoder work when checking a valid hosted video.

**How to apply:** Verify media frame extraction with real-time browser execution rather than treating virtual-time seek timeouts as proof that a clip is unplayable.