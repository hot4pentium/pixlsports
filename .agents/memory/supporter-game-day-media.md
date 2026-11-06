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

Record Moments should not add an instrumental bed under the selected action. A brief, optional sound effect may play only during an animated shoutout intro and must end before original clip audio begins.

**Why:** The user tested the animated intro in the simulator and asked for effects with the shoutout instead of instrumental music over the original audio.

**How to apply:** Keep music out of the exported action segment. Keep any intro effect short, user-controllable, and confined to the intro timeline.