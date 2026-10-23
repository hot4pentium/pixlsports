---
name: Schedule stage precedence
description: How saved game statuses and remembered selections affect next-event guidance.
---

Treat a dated event from a previous local calendar day as completed even if its persisted status still says upcoming or live. A remembered completed-game selection should not override the next practice or meeting in preparation guidance; a deliberate selection made during the current session may still show past-game details.

**Why:** A production schedule contained both a past game marked upcoming and a future practice. The stale status made the past game win the next-event recommendation, and a remembered game selection could independently keep the prep card on game-day wording.

**How to apply:** When changing dashboard event ranking or selection, cover stale saved statuses and persisted active-game selections together, while keeping intentional past-game review available.

When all scheduled games are complete, an older game remembered from another visit must not remain the default game context ahead of the most recent completed game. Past games remain reviewable through Calendar or Game On cards, not through the dashboard's top notification.

**Why:** The dashboard could say there was no upcoming game while still featuring an old game's date even though a newer game had already taken place.

**How to apply:** Compare completed game dates independent of input ordering for supporting tool context, but keep past dates out of the top next-game notification.

The mobile “Coming up” card should show the closest upcoming calendar event, even if the prep card already recommends that same event. It is a confirmation of what is next, not a preview of the event after next.

**Why:** Skipping the recommended event made the prep card correctly switch to a newly added game while the calendar card appeared stuck on a later practice.

**How to apply:** Use one upcoming-event ordering rule for both recommendation and calendar display; if a live game is prioritized for prep, “Coming up” can still show the next future event.

For a fan-owned tracked game, persist its completion time with the final schedule status. A recently finalized game should stay ahead of future preparation recommendations for the short post-game Send window; once that window expires, the next scheduled event should win again.

The mobile message board follows the same post-game priority: direct the supporter back to the ended Event Card to share, rather than immediately showing the next event.

**Why:** Ending tracking previously changed only the status, so the dashboard could immediately jump from Capture to preparation for the next event and skip Send. A completion timestamp distinguishes that transition from an old final game.

**How to apply:** Keep the post-game window bounded and require the explicit final status plus a valid timestamp; do not let legacy or stale completed games override future practice, meeting, or game guidance.

Completed meetings belong to history rather than the active weekly path. Once a meeting ends, recommend the next upcoming calendar event; if none exists, return the path to Plan. An active game still has priority.

**Why:** The recap already remains available in Previous meetings, so leaving Share active makes the path appear stuck on an event that is over.

**How to apply:** Exclude completed meeting IDs from upcoming-event selection, retain their local recap records, and cover reload, next-event, no-event, and active-game cases together.