---
name: Premium card background removal
description: Runtime and licensing decisions for athlete cutouts in Gallery and Spotlight.
---

Keep background removal local to the device, preserve the original photo, and treat the cutout as a replaceable derivative.

**Why:** A failed download, inference, or stale asynchronous result must not destroy the user's photo or require a paid image-processing service. MODNet was selected with an Apache-2.0 model license rather than a restrictive runtime/model license.

**How to apply:** Keep the original-photo fallback and an explicit retry available. Retain source identity checks when introducing new derivative-generation paths.

Classic HYPE Cards always show the full original photo filling the card, with the athlete's name in a lower third and navigation beneath the card; only premium styles may use the background-removed cutout.

**Why:** The user rejected the contained-thumbnail preview and explicitly requested a photo-filled Classic card, a lower-third name, and navigation beneath it.

**How to apply:** Keep the owner design preview consistent with the live Classic card. Use the original photo even when a cutout exists; fill the frame rather than letterboxing it.

Prebundle lazy browser-inference dependencies before the first upload in Vite development.

**Why:** First-use optimization of Transformers.js caused a full page reload during inference; the pending worker promise disappeared even though the inference code itself was sound.

**How to apply:** Warm/prebundle the dependency before browser smoke tests. Test real inference as well as download-failure fallback; a screenshot cannot establish that a worker completed.

Keep one placement workflow, not separate "Move athlete" and horizontal/vertical placement panels.

**Why:** The user called those controls redundant and reported that neither moved their photo. The original-photo fallback had not been receiving the placement transform.

**How to apply:** Offer positioning, size, and one placement reset together. Verify visible movement and resize for both original photos and cutouts, not only changes in saved numeric settings.

Keep Gallery, Spotlight, and Breakout avatar placement independent and restore each design's saved position when users switch between templates.

**Why:** The user wants to compare and switch templates without losing the distinct avatar composition they set for each one.

**How to apply:** Persist per-design position and scale in the card appearance, migrate legacy shared placement to all premium designs, and verify design switches plus save/reload.