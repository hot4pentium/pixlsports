---
name: Event Card pregame state
description: Defines the supporter Event Card lifecycle and timing rule separating card status from tracker access.
---

Event Cards are the backbone of the supporter experience. Opening the selected card should lead into the current event task: prepare before the game, track stats during it, or share the athlete’s HYPE Card afterward. If there is no future Event Card, the primary action is to create one. Keep Live Taps separate from stat tracking.

**Why:** the user explicitly defined this end-to-end Event Card lifecycle as the core iOS experience.

**How to apply:** use the Event Card as the entry point for stage-specific work, preserve event identity through each destination, and offer creation when no future card exists. The timing rules below determine which action is primary.

Event Card display timing stays separate from tool availability: the dashboard can open Track Stats ten minutes before kickoff, but the card remains “Starting Soon” until its scheduled start in the saved time zone, then becomes “Live.” Resolve nonexistent spring-forward wall times by moving forward by the clock gap; resolve repeated fall-back wall times to their earlier instant. The badge and tool window must use that same resolved start.

**Why:** The user limited Track Stats access to the final ten minutes before a game. Announcing a future game as live is misleading, and DST ambiguity needs one stable instant so the tool window and Live transition cannot disagree.

**How to apply:** Keep schedule-card display timing distinct from tracker access, and test both against the event’s IANA time zone at the ten-minute access boundary and kickoff, including skipped and repeated local times.

Event Cards stop being active two hours after their scheduled start in the saved time zone, including cards whose persisted status still says Live. With no future Event Card, the bulletin board must offer Create Event Card; passed games must not recommend Prep.

**Why:** The user reported a passed 9 AM production event still recommending Prep and explicitly requested the create-event guidance after two hours when no future card exists.

**How to apply:** Bound active Event Card guidance without automatically finalizing tracker data or changing the tracker's independent capture rules. Keep every passed Event Card in the season list as a completed calendar marker, regardless of age or stale saved status; only the nearest future card may say “Up Next.”

For games, highlight Stat Tracker from ten minutes before kickoff through the first hour after it starts; highlight Share from +1 hour until +2 hours. When the next future game reaches its ten-minute Track Stats window, move dashboard guidance to it even if an earlier game is still active. Keep earlier completed Event Cards visible and tappable for their own tools. At +2 hours, advance to the next upcoming Event Card and highlight Prep, or show Create Event Card if none remains.

**Why:** The user requested a ten-minute Track Stats limit and automatic focus on the next close event, while confirming that earlier Event Cards remain useful for accessing their tools.

**How to apply:** Derive the phase from scheduled date, time, and saved time zone, not persisted event status or a saved completion timestamp. Keep the nearest future card labeled “Up Next” until kickoff; do not hide or delete earlier cards, change saved stats, or create a Share highlight when the card has no Share action.

Use the saturated blue action fill only for the currently recommended action. A permanently blue Prep button reads as highlighted even when Stat Tracker or Share is recommended.

**Why:** The user reported that the blue default Prep button looked selected after the game-time recommendation had moved to Stat Tracker.

**How to apply:** Keep non-recommended Prep visually neutral; retain the blue fill and NEXT marker only while Prep is the suggested action.

Only the nearest upcoming Event Card should display “Up Next.” Later future cards must have no status label or status dot. Live and Complete labels remain available for their respective states.

**Why:** The user repeatedly requested that later scheduled games not also be called “Up Next.”

**How to apply:** Choose the next upcoming card once from the chronologically ordered dashboard list, excluding Live and Complete cards. Keep the same exclusive badge rule in the three-column grid and the large-text layout.

Do not show a ten-minute availability message or reserve a status row beneath the
Prep / Track Stats / Share navigation. Keep timing explanations and optional
reminders inside the tool chooser opened by Track Stats.

**Why:** The user said the warning beneath navigation is unnecessary because users
will learn availability when they tap Track Stats.

**How to apply:** Remove only the navigation copy and its space; retain the
ten-minute access rule, clickable game-tool chooser and always-available recording.

Shared HYPE Card event labels must agree with the owner's calendar display, and
user-visible event times must use 12-hour AM/PM format.

**Why:** The user reported that a received HYPE Card still called an event from
the previous day Live while the owner's card showed Complete, and explicitly
requested 12-hour times.

**How to apply:** Use the event's saved time zone and the native owner's display
phases for public calendar labels, rather than trusting stale persisted Live
values. Calendar Complete is not permission to finalize a tracker or invent a
score. Preserve private tools' actual lifecycle, format saved wall times without
converting them to a recipient's zone, and keep existing public-card refreshes.