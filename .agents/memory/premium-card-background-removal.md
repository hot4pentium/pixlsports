---
name: Premium card background removal
description: Runtime and licensing decisions for athlete cutouts in Gallery and Spotlight.
---

Keep background removal local to the device, preserve the original photo, and treat the cutout as a replaceable derivative.

**Why:** A failed download, inference, or stale asynchronous result must not destroy the user's photo or require a paid image-processing service. MODNet was selected with an Apache-2.0 model license rather than a restrictive runtime/model license.

**How to apply:** Keep the original-photo fallback and an explicit retry available. Retain source identity checks when introducing new derivative-generation paths.

Classic HYPE Cards always show the full original photo; only premium styles may use the background-removed cutout.

**Why:** The user wants Classic to retain the photo's full background rather than display a transparent cutout.

**How to apply:** Classic previews and live renders should use the original photo URL even when a cutout exists.

Prebundle lazy browser-inference dependencies before the first upload in Vite development.

**Why:** First-use optimization of Transformers.js caused a full page reload during inference; the pending worker promise disappeared even though the inference code itself was sound.

**How to apply:** Warm/prebundle the dependency before browser smoke tests. Test real inference as well as download-failure fallback; a screenshot cannot establish that a worker completed.

Keep one placement workflow, not separate "Move athlete" and horizontal/vertical placement panels.

**Why:** The user called those controls redundant and reported that neither moved their photo. The original-photo fallback had not been receiving the placement transform.

**How to apply:** Offer positioning, size, and one placement reset together. Verify visible movement and resize for both original photos and cutouts, not only changes in saved numeric settings.