---
name: Live Taps concept
description: The original game-day interaction idea behind Live Taps.
---

Live Taps is scoped to one athlete. Family members can tap sport-specific, preloaded cheer options to add to a tally. Do not add teammate selection or treat the cheers as official stats.

**Why:** The user clarified that the goal is a tally of sport-specific cheers from family members, not adding other athletes as tap targets.

**How to apply:** Keep the interaction separate from stat tracking and video. Family members may cheer for the athlete; do not turn a tap into a tracked play or teammate feature.

For write access, the owner creates revocable family links. Store only a hash of each bearer token; carry the raw token in the URL fragment and remove it from the address bar after the card reads it. A public HYPE Card URL is always view-only. Store each tap by athlete invite, game, and cheer; revoking a link must not erase its earlier taps. Show the active game's tally without merging it into official stats.

**Why:** The public card is meant to be shared broadly, so its URL cannot also grant write access. Game-scoped records preserve cheer history without changing the official stat record.

**How to apply:** Keep link authorization independent of public-card loading, and preserve old tap rows when access is revoked or a live share ends.