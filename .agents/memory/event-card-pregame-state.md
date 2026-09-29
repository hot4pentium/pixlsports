---
name: Event Card pregame state
description: Product timing rule separating Event Card status from early tracker access.
---

Event Cards should show “Starting Soon” during the one-hour pregame capture window and switch to “Live” at the event’s scheduled start in its saved time zone. The tracker may still treat that pregame window as capture-eligible.

**Why:** The early stage was useful for preparing and capturing game data, but reusing it for the card’s visible badge announced a game as live before kickoff.

**How to apply:** Keep schedule-card display timing distinct from tracker/preparation timing, and test both against the event’s IANA time zone at the capture-window and kickoff boundaries.