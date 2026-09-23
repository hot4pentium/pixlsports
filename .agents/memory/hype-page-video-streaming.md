---
name: Hype Page video streaming
description: Why public Hype Page video delivery must support byte ranges.
---

Serve public Hype Page videos with browser-compatible byte ranges, including `206` partial content and `416` for unsatisfiable requests. Do not treat a successful poster fetch or an initial `200` video response as proof that playback works.

**Why:** Production playback showed a thumbnail briefly and then a black player while repeated full-file video responses were aborted. The player needs partial requests for initial loading and seeking, especially when the video index is not at the beginning.

**How to apply:** For future media delivery changes, verify range headers and partial response byte counts separately from poster loading and confirm the browser can play the video after loading metadata.