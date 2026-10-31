---
name: Event Card pregame state
description: Defines the supporter Event Card lifecycle and timing rule separating card status from tracker access.
---

Event Cards are the backbone of the supporter experience. Opening the selected card should lead into the current event task: prepare before the game, track stats during it, or share the athlete’s HYPE Card afterward. If there is no future Event Card, the primary action is to create one. Keep Live Taps separate from stat tracking.

**Why:** the user explicitly defined this end-to-end Event Card lifecycle as the core iOS experience.

**How to apply:** use the Event Card as the entry point for stage-specific work, preserve event identity through each destination, and offer creation when no future card exists. The timing rules below determine which action is primary.

Event Cards should show “Starting Soon” during the one-hour pregame capture window and switch to “Live” at the event’s scheduled start in its saved time zone. The tracker may still treat that pregame window as capture-eligible. Resolve nonexistent spring-forward wall times by moving forward by the clock gap; resolve repeated fall-back wall times to their earlier instant. The badge and capture window must use that same resolved start.

**Why:** The early stage was useful for preparing and capturing game data, but reusing it for the card’s visible badge announced a game as live before kickoff. DST ambiguity also needs one stable instant so the pregame window and Live transition cannot disagree.

**How to apply:** Keep schedule-card display timing distinct from tracker/preparation timing, and test both against the event’s IANA time zone at capture-window and kickoff boundaries, including skipped and repeated local times.

Event Cards stop being active two hours after their scheduled start in the saved time zone, including cards whose persisted status still says Live. With no future Event Card, the bulletin board must offer Create Event Card; passed games must not recommend Prep.

**Why:** The user reported a passed 9 AM production event still recommending Prep and explicitly requested the create-event guidance after two hours when no future card exists.

**How to apply:** Bound Event Card display and guidance without automatically finalizing tracker data or changing the tracker's independent capture rules. Keep passed cards available for review.

For games, highlight Stat Tracker starting one hour before kickoff and through the first hour after it starts; highlight Share from +1 hour until +2 hours. At +2 hours, advance to the next upcoming Event Card and highlight Prep, or show Create Event Card if none remains.

**Why:** The user requested this timed Event Card action rhythm to make the next useful action clear at each game stage.

**How to apply:** Derive the phase from scheduled date, time, and saved time zone, not persisted event status or a saved completion timestamp. Keep practice preparation separate, and do not create a Share highlight when the card has no Share action.

Use the saturated blue action fill only for the currently recommended action. A permanently blue Prep button reads as highlighted even when Stat Tracker or Share is recommended.

**Why:** The user reported that the blue default Prep button looked selected after the game-time recommendation had moved to Stat Tracker.

**How to apply:** Keep non-recommended Prep visually neutral; retain the blue fill and NEXT marker only while Prep is the suggested action.