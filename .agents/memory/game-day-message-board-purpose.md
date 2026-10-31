---
name: Game-day message board purpose
description: The supporter dashboard's Message Board is a time-aware guide, distinct from the Shoutouts & Replies inbox.
---

The user defines the Message Board as the dashboard card beside the athlete's HYPE Card. It leads the supporter to the next task based on when the Event Card is, starts, and ends.

**Why:** The user clarified this while providing the mobile dashboard reference.

**How to apply:** Keep the Message Board focused on schedule-aware preparation, live-event, and post-event actions. Do not substitute the Shoutouts & Replies inbox.

For native iPhone, the Message Board should show event details beside the HYPE Card. The Up Next section uses three square Event Card tiles per row; opening a card offers native Prep, stat tracking for games, and sharing.

**Why:** The user requested this layout and explicitly chose native tools instead of temporarily opening the web tools.

**How to apply:** Use the PWA's behavior as the reference, preserve existing account-owned checklist and game history, and keep these actions inside the native journey.

Opened native Event Cards should use compact, organized details with Prep, Track Stats, and Share step buttons at the bottom. Each opens its native section, and the recommended step is highlighted according to the event's timing.

**Why:** The user requested less vertical detail layout and a clear, time-aware sequence of actions.

**How to apply:** Keep the step bar visible as details scroll, preserve readable larger-text layouts, and distinguish recommendation changes from actual saved completion or game finalization.

Keep only event/team identity plus date, time, and location in the Event Card hero. Remove opponent, season, and other detail rows so the selected tool content has more room.

**Why:** The user clarified that the hero should stay compact so the active Prep, Track Stats, or Share content gets more space.

**How to apply:** Place the identity beside schedule metadata at standard text sizes; stack them at accessibility sizes.

Use the section beneath Event Details as the active native Prep, Track Stats, or Share panel rather than a permanent read-only Prep summary. The user calls this section “Content.”

**Why:** The user preferred using the same area for the selected task instead of opening another screen for every tool.

**How to apply:** Keep the bottom steps available, initially select the time-recommended step, and do not force a different selection while the user works. Retain unfinished Prep and pending tracker changes when switching panels. Prep begins with a short interactive checklist and a control to open the full manager.

**Why:** The user chose a compact checklist with a separate full-list management action.

**How to apply:** Keep quick checklist changes in the same draft and save flow as the full Prep editor; the full editor remains responsible for adding, removing, and editing tasks and notes.

Within Track Stats, open score-only tracking directly in Content, with team and opponent scores, Start/End Game, Access Live Taps, and Open full tracker. Do not require a second stats-mode selection or put individual player-stat buttons in this compact panel.

**Why:** The user wants supporters to be able to keep only the score, while retaining separate access to Live Taps and full stat tracking. Cheers must remain distinct from recorded stats.

**How to apply:** Compact and full tracking must use the same game state. Fan QR creation requires an active session and verified ownership. Existing family QR access lasts until revoked: explain this clearly and provide revocation, rather than implying that these codes expire at the end of a game.

All mounted event editors must share one workspace command/recovery owner, including Prep and both tracker presentations.

**Why:** Separate controllers can overwrite or clear the same event-scoped pending-save journal. A tracker retry or discard must also never erase an unrelated unsaved Prep draft.

**How to apply:** Serialize pending saves across tools and distinguish recovery of a failed Prep save from recovery of a tracker command. Preserve local Prep edits during tracker-only reloads.
