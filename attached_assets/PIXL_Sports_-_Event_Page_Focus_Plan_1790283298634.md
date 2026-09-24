# PIXL Sports: One Workspace Plan for Replit

## Product direction

Create **one main workspace page** where a user moves easily among **Calendar, Prep, Stats, and Hype**. These are four sections of the same experience. The selected event provides context throughout the workspace. A parent can use PIXL without a coach setting up a team or roster.

The promise is: **See what's next, get ready, capture the game, and share the moment.** Keep the next useful action prominent, while letting the user open any section at any time.

## Page structure

**Header:** selected athlete or team, selected or next event, date and location, and one suggested action. Provide an obvious event switcher. If there is no event, show Add Event.

**Navigation:** Calendar | Prep | Stats | Hype. On desktop, use tabs or a compact navigation rail. On mobile, keep all four labels visible in a simple navigation pattern. Avoid a dashboard with four large competing cards.

| Section | Main job | Contents |
| --- | --- | --- |
| Calendar | Choose what's happening | Event list or calendar, event details, add/edit event |
| Prep | Get ready | Checklist, arrival and travel notes, what to bring |
| Stats | Capture the game | Quick result, individual athlete stats, moments, optional advanced team tracker |
| Hype | Follow and celebrate | Hype Page preview, Hype Card creator, graphics, publishing and sharing |

The event switcher is the glue. Choosing a game updates its details, checklist, result, moments, and relevant Hype content across the four sections. Switching sections keeps the event selected. Starting from Calendar selects an event and opens its relevant section. The suggested action links to the correct section, for example “Finish Saturday's checklist,” “Record today's result,” or “Share the Hype Card.” Never lock sections based only on the date.

## Event types

**Game:** all four sections apply.

**Practice:** Calendar and Prep show event details, checklist, and notes. Stats can show an appropriate empty state or optional practice notes; no final score prompt.

**Meeting:** Calendar shows details. Prep offers a lightweight agenda, notes, and action items. Keep the existing agenda builder behind an optional Add agenda action and preserve saved agendas. Stats never opens a game tracker for meetings. Hype does not prompt for a meeting card by default.

## Simplify Stats

Make **Athlete + Result** the default game capture mode: opponent, final score, a few optional sport-specific athlete stats, and moments or notes. A parent can skip stats and still record a memorable play. No roster or continuous play-by-play is required.

Retain the existing full team tracker as **Advanced team stats** within Stats, including access to all existing records. Do not delete or silently change saved stats. Identify personal, user-entered entries clearly so shared content does not imply an official team record.

## Hype Page and Hype Card

The **Hype Page** is the shareable place where family follows the athlete and sees selected updates across games. A **Hype Card** is a graphic made from a particular moment, result, or upcoming event. The Hype section shows a Hype Page preview, recent entries for the selected athlete, and Create Hype Card. The selected event can prefill relevant card details.

Provide explicit controls for publishing results, photos, moments, and graphics. Private notes and checklists stay private. Allow preview and unpublish. For youth athletes, publishing identifying details or photos should be an intentional choice. If the existing Hype Page has a different ownership model, preserve it and adapt the navigation rather than replacing its data.

## Main journeys

1. **Start:** A parent adds a game in Calendar and lands in the workspace with it selected, without team setup.
2. **Prepare:** They open Prep, use the checklist, and optionally make a pregame Hype Card.
3. **Capture:** They open Stats, record a result and an athlete moment, or choose Advanced team stats.
4. **Share:** They open Hype, select what to publish, make a Card, preview the Hype Page, and share it.
5. **Switch events:** They select another event from the header or Calendar; all sections update consistently.

## Instructions for Replit

Inspect the current routes, database schema, roles, and components first. Summarize how events, prep, stats, Hype Cards, Hype Pages, and agendas connect today. Then implement the smallest safe changes in phases:

1. Build the main workspace shell with four-section navigation and a persistent event selector. Reuse existing components initially.
2. Connect Calendar selection to Prep, Stats, and Hype. Preserve data, permissions, and old URLs; redirect or link existing entry points.
3. Add the simple Athlete + Result path. Keep the full team tracker accessible as Advanced team stats.
4. Connect saved moments and results to Hype, with preview and publishing controls. Reuse existing Card and Page implementations.
5. Refine mobile navigation and the suggested action. Preserve selected context across section changes, saves, refresh, and returns where appropriate.

Do not rewrite the app, remove working features, or build a new scoring engine. If schema changes are necessary, show the schema and migration plan before applying them. Deliver each phase in a usable state.

## Acceptance checks

- A user switches among Calendar, Prep, Stats, and Hype without losing the selected game.
- A new parent adds a game, completes prep, logs a result and athlete moment, and shares Hype content without a roster.
- Existing team stats and meeting agendas still open and remain editable.
- Practice and meeting views do not prompt for final scores or game stats.
- Private checklists and draft moments never appear on the shared Hype Page.
- The suggested action opens the right section and event; users can still choose any section.
- The full journey works comfortably on a phone and survives refresh.

## Positioning to test

**PIXL Sports gives families one place to navigate the game week and celebrate the athlete.** Test the workspace with parents using a real upcoming event. Watch whether they can find each section, switch events, and share something meaningful without help.
