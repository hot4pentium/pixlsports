---
name: Supporter game-day media
description: Product boundary for supporter capture and cross-tool game context.
---

Supporter game-day capture must remain device-managed. Pixl Sports may open the device camera or media picker and pass schedule context into existing tools, but it must not upload captured files, persist them as app media, or create a separate moment library.

**Why:** The release is intentionally a guided web journey around the existing schedule, checklist, Stat Tracker, and Hype Card. Camera-roll ownership avoids duplicating users' media and expanding cloud-storage scope.

**How to apply:** Keep game identity durable across the dashboard and tool handoffs. Let the Hype Card editor ask the user to choose camera-roll media when they are ready to create a card.

The native iPhone flow should offer three ways to support the athlete: Track Stats, Live Taps, or Record Moments. Record Moments is also usable outside a scheduled game.

**Why:** The user described this as the third Game Day option and wants families to create and share a clip at any time, not only at the event.

**How to apply:** Record Moments creates a device-local video with a selected shoutout graphic as a lead-in, then the selected clip. Keep up to 15 seconds of footage; the intro is additional and must not consume that footage allowance. Let the user save the finished video to their phone and share it later. Use the user's supplied original graphics, not crops of the overview screenshot. This does not authorize automatic hosting or a separate cloud moment library.

Record Moments should not add a music bed under the selected action. A short, optional music cue or sound effect may play only during an animated shoutout intro and must end before original clip audio begins. Original video audio should fade in gently as the footage begins.

**Why:** The user tested the animated intro and wants any added audio confined to the shoutout intro, never under the original action. They later chose a supplied short music cue to replace the whoosh-and-hit effect and requested a fade-in for the video's own audio.

**How to apply:** Keep added audio out of the exported action segment. Keep any intro cue short, user-controllable, and faded out before the original clip audio starts.

Videos explicitly added to the HYPE Card from Record Moments should stay there until the owner removes or replaces them. Keep that permanent three-slot card media separate from expiring one-off video shares.

**Why:** The user chose “stay until replaced” for HYPE Card videos.

**How to apply:** Delete stored video and poster objects when a card video is replaced or removed; do not expire it automatically. Preserve existing expiration behavior for one-off shares.

When the proposed two-month paid pass ends, hosted HYPE Card videos remain stored but are greyed out and unavailable; Live Taps QR access stops, and the rest of the app returns to the free options.

**Why:** The user chose to revert to free features after the pass, with hosted videos locked rather than deleted.

**How to apply:** At pass expiry, lock clip playback without deleting stored media, stop QR access, and preserve the free Event Cards, Prep, Stats, owner-only Live Taps, and local Record Moments flows.