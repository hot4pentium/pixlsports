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

On the Share step, keep a compact “Share event details” action below the hero, without repeating the event title, date, time, or location. Keep the Athlete Showcase review action separate.

**Why:** The user said the event information is redundant at the “Send the hype” stage because those details are already in the hero.

**How to apply:** Keep the hero as the visible source of event details, but include the full details in the share-sheet payload. The compact action must remain easy to find and tap.

Opened native Event Cards should use compact, organized details with Prep, Track Stats, and Share step buttons at the bottom. Each opens its native section, the recommended step is highlighted according to event timing, and the selected navigation step identifies the active tool. Do not add numbered step badges or repeat an event banner inside each tool.

**Why:** The user requested less vertical detail layout and said the navigation already tells people which step is open; repeated event banners take space away from the task. They confirmed that loading this navigation with each Event Card is a good flow for users.

**How to apply:** Keep the step bar visible as details scroll and preserve readable larger-text layouts. Keep event information in the shared Event Details hero, not in repeated Prep, Track Stats, or Share banners. Distinguish recommendation changes from actual saved completion or game finalization.

Keep only event/team identity plus date, time, and location in the Event Card hero. Remove opponent, season, and other detail rows so the selected tool content has more room.

**Why:** The user clarified that the hero should stay compact so the active Prep, Track Stats, or Share content gets more space.

**How to apply:** Place the identity beside schedule metadata at standard text sizes; stack them at accessibility sizes.

Use the section beneath Event Details as the active native Prep, Track Stats, or Share panel rather than a permanent read-only Prep summary. The user calls this section “Content.”

**Why:** The user preferred using the same area for the selected task instead of opening another screen for every tool.

**How to apply:** Keep the bottom steps available, initially select the time-recommended step, and do not force a different selection while the user works. Retain unfinished Prep and pending tracker changes when switching panels. Prep Content shows the entire interactive checklist; Manage is for adding/removing tasks and editing event notes.

**Why:** The user clarified that the entire checklist belongs in Content and Manage should focus on tasks and event notes.

**How to apply:** Keep checklist changes in the same draft and save flow as task and note management; allow the full list to scroll within Event Details.

Keep the Prep checklist collapsible in both Content and Manage. Checking the final task celebrates the direct action and collapses the list; adding a task reopens it. Restored completion stays quiet.

**Why:** The user wants a compact Prep view that closes on completion, while still reopening naturally when the task list changes.

**How to apply:** Respect Reduce Motion and do not replay the celebration when saved or remote state loads.

Within Track Stats, open score-only tracking directly in Content, with team and opponent scores, Start/End Game, Live Taps, and Open full tracker. Place scorekeeping and Live Taps in clearly separate sections, and explain that Live Taps are cheer-only.

**Why:** The user wants supporters to be able to keep only the score, while retaining separate access to Live Taps and full stat tracking. Cheers must remain distinct from recorded stats.

**How to apply:** Compact and full tracking must use the same game state. Fan QR creation requires an active session and verified ownership. Existing family QR access lasts until revoked: explain this clearly and provide revocation, rather than implying that these codes expire at the end of a game.

When Track Stats opens, ask the supporter to choose Stat Tracker or Live Taps in a modal. Give each choice a question-mark explanation and allow switching later.

**Why:** The user explicitly asked for a mode choice before entering either tracking experience.

**How to apply:** Keep the scorekeeping state and any Live Taps session/QR state alive while switching modes; do not start either tool until selected.

All mounted event editors must share one workspace command/recovery owner, including Prep and both tracker presentations.

**Why:** Separate controllers can overwrite or clear the same event-scoped pending-save journal. A tracker retry or discard must also never erase an unrelated unsaved Prep draft.

**How to apply:** Serialize pending saves across tools and distinguish recovery of a failed Prep save from recovery of a tracker command. Preserve local Prep edits during tracker-only reloads.

Prep, Track Stats, and Share should each have a distinct visual identity—orange for Prep, light blue for Track Stats, and PIXL green for Share—so supporters can tell which task is active at a glance. Keep their shared Event Card context and fixed step navigation.

**Why:** The user said the current tool pages look the same, asked for clear recognition, and specified these colors.

**How to apply:** Carry each color through its page, action, and selected step. Give Prep a checklist/readiness hierarchy, Track Stats a scorekeeping hierarchy, and Share a sharing-action hierarchy. Preserve the shared workspace and existing save, authorization, and recommendation behavior.

Explicitly completed games must not restart stat tracking or Live Taps, including a game finalized on the phone but not yet synced. Share is the recommended postgame destination; the Track Stats chooser remains clickable for Record Moments. Prep and pending-save recovery remain available. Elapsed schedule time alone does not finalize an unfinished game.

**Why:** The user wants completed tracking protected while retaining recording at any time. Offline finalization must have the same effect without losing outstanding saves.

**How to apply:** Use both event and device workspace completion, not only kickoff timing. Preserve queued commands, retry controls, and management of already-active cheers when leaving tracking.

Keep the native Track Stats destination clickable. Gate only stat tracking and
starting Live Taps until ten minutes before kickoff; Record Moments is always
available through the chooser, including after completion or with a missing start.

**Why:** The user revised the earlier whole-tab lock so families can still make
clips and see when the other tools become available.

**How to apply:** Explain the opening time in the event's time zone, update it
inline, and offer an optional per-event local reminder. Do not force navigation
or dismiss recording when timing/completion changes. Keep Prep, Share, recovery,
and ending existing cheers reachable. Completed games cannot restart tracking;
local pending schedule edits and finalization have the same authority as synced data.

In the taller dashboard Message Board, keep details left-aligned but vertically centered in the space above the lower Next Step footer, with a protected gap before the footer.

**Why:** The user asked to move the details down to use the increased height, while preserving space above Next Step.

**How to apply:** Keep the status badge clear and let long details and accessibility text reflow; do not change the adjacent HYPE Card or centered Fan Base button.
