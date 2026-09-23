---
name: Hype Page video streaming
description: Why public Hype Page video delivery must support byte ranges.
---

Serve public Hype Page videos with **bounded** browser-compatible byte ranges, including `206` partial content and `416` for unsatisfiable requests. An open-ended `bytes=0-` request must not return the entire large clip in one response. Do not treat a successful poster fetch or an initial `206` response as proof that playback works.

**Why:** Production playback showed a thumbnail briefly and then a black player. Supporting ranges changed requests from `200` to `206`, but playback still failed: a small explicit range succeeded while `bytes=0-` over a roughly 35 MB clip returned `500` through the published proxy. The uploaded MP4 itself decoded as H.264/AAC and had the expected duration; the first 1 MB sample misleadingly reported a short duration because it was incomplete.

**How to apply:** For future media delivery changes, verify both small explicit and open-ended range requests on a realistically sized clip, not just `bytes=0-1`. Keep each response below the proxy limit and let browsers request subsequent segments. Confirm playback separately after publishing.