---
name: Live Taps concept
description: The original game-day interaction idea behind Live Taps.
---

Live Taps is scoped to one athlete. Family members can tap sport-specific, preloaded cheer options to add to a tally. Do not add teammate selection or treat the cheers as official stats.

**Why:** The user clarified that the goal is a tally of sport-specific cheers from family members, not adding other athletes as tap targets.

**How to apply:** Keep the interaction separate from stat tracking and video. Family members may cheer for the athlete; do not turn a tap into a tracked play or teammate feature.

For write access, the owner creates revocable family QR codes for in-person scanning. Store only a hash of each bearer token; encode the raw token in the QR code's URL fragment and remove it from the address bar after the card reads it. A public HYPE Card URL is always view-only. Store each tap by athlete invite, game, and cheer; revoking access must not erase its earlier taps. Show the active game's tally without merging it into official stats.

**Why:** The public card is meant to be shared broadly, so its URL cannot also grant write access. The user prefers QR access because family members need to be present to send Live Taps. Game-scoped records preserve cheer history without changing the official stat record.

**How to apply:** Keep QR authorization independent of public-card loading, and preserve old tap rows when access is revoked or a live share ends.

Keep each cheer attached to a distinct season identity as well as its display name. When an owner changes the season, archive unassigned legacy taps under the previous season and start a new identity; do not use the season label alone as the grouping key because a label can be reused later.

**Why:** A new season must start with a fresh total while prior HYPE Card records remain available, including when an athlete later reuses an earlier season label.

**How to apply:** Store the season identity and name with each tap, filter current-game and season totals by that identity, and expose older season groups separately.

Owner recovery must use authenticated, owner-only session metadata. Do not expose Event Card recovery identifiers through public share responses or HYPE Card links.

**Why:** Owners need a device-independent way to return to an active session, but public sharing must remain view-only.

**How to apply:** Keep recovery metadata on owner-authenticated share responses and remove it from public game snapshots.

Every supported sport also includes the shared cheers “Thumbs Up,” “Way to Go!” and “Big Play,” alongside its sport-specific options.

**Why:** The user explicitly requested these three buttons on all Live Taps.

**How to apply:** Keep them in the server-defined cheer presets so display, tally, and API validation stay consistent for every supported sport.

When a supporter opens Stat Tracker from an Event Card, present separate paths for full stat tracking and Live Taps only, clearly stating that Live Taps does not record player stats.

**Why:** The user wants a clear no-stats choice at the Event Card's Stat Tracker button for days when supporters prefer cheers over tracking.

**How to apply:** Keep both choices tied to the same event. Live Taps continues to use private, revocable family QR access and must not write cheers into official stats.