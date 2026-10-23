---
name: Event Card pregame state
description: Product timing rule separating Event Card status from early tracker access.
---

Event Cards should show “Starting Soon” during the one-hour pregame capture window and switch to “Live” at the event’s scheduled start in its saved time zone. The tracker may still treat that pregame window as capture-eligible. Resolve nonexistent spring-forward wall times by moving forward by the clock gap; resolve repeated fall-back wall times to their earlier instant. The badge and capture window must use that same resolved start.

**Why:** The early stage was useful for preparing and capturing game data, but reusing it for the card’s visible badge announced a game as live before kickoff. DST ambiguity also needs one stable instant so the pregame window and Live transition cannot disagree.

**How to apply:** Keep schedule-card display timing distinct from tracker/preparation timing, and test both against the event’s IANA time zone at capture-window and kickoff boundaries, including skipped and repeated local times.

Event Cards stop being active two hours after their scheduled start in the saved time zone, including cards whose persisted status still says Live. With no future Event Card, the bulletin board must offer Create Event Card; passed games must not recommend Prep.

**Why:** The user reported a passed 9 AM production event still recommending Prep and explicitly requested the create-event guidance after two hours when no future card exists.

**How to apply:** Bound Event Card display and guidance without automatically finalizing tracker data or changing the tracker's independent capture rules. Keep passed cards available for review.