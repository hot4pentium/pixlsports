---
name: Hub card identity
description: Identity safety for the Supporter Hub's saved HYPE Card preview and destination.
---

Do not treat having only one saved HYPE Card as evidence that it belongs to the current athlete. When saved identity does not match the selected athlete and team, offer setup/manage rather than showing or linking another athlete's card. A profile edit may sync a live card only when the previous saved athlete and team matched it and no card already matches the new identity. For an existing mismatch, offer an explicit owner-only reconnection choice; never select a card silently.

When exactly one owned card matches the selected athlete and team, keep it linked even if the profile's sport or season differs. Use sport and season to disambiguate multiple cards, not to reject a unique same-athlete/team card.

**Why:** An athlete may have a card for one sport while the showcase profile is set to another; strict sport matching falsely reported that the card was not linked.

**How to apply:** Match athlete and team first, then narrow multiple matches by sport and season. If more than one card remains possible, do not silently choose one.

**Why:** Pairing the mobile schedule with saved artwork makes the older sole-card fallback visibly misleading after an athlete or team change. Profile edits should carry through for the same athlete, while a different athlete's design must not be reused without an explicit owner choice.

**How to apply:** Keep the preview and its full-card destination based on the same identity decision. Account-scoped loading or failures must not substitute another user's cached artwork. Owner-authorized identity updates preserve the existing artwork and share link.