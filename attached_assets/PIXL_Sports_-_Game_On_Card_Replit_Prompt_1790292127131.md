# Replit prompt: Make Game On cards the center of PIXL Sports

I want to refocus PIXL Sports around **creating and sharing a Game On card for each game or practice**. The main user is a parent or supporter following an athlete. The user should be able to create a card without a coach account, team roster, season schedule, or full calendar setup.

Please inspect my current routes, database, components, and permissions before changing code. First tell me which existing pieces can be reused and how you will preserve existing events, prep lists, stats, Hype Cards, and Hype Pages. Then implement the change in small, usable phases.

## Core experience

The owner dashboard should lead with **Create Game On card**. Show created cards in an attractive, mobile-friendly carousel, with the next upcoming event first and a clear **View all** list for finding older cards. A card displays enough information to recognize the event: athlete, game or practice, opponent when relevant, date/time, and status (Draft, Published, Live, Complete). It should not require browsing a calendar.

When the owner taps a card, open its **owner workspace**, with:

- **Details:** game/practice type, athlete, date, time, location, opponent for games, and optional arrival note.
- **Prep:** the owner's checklist and notes. The owner can explicitly share selected tasks or a helper link; private items never appear to visitors.
- **Track:** for games, quick result, individual athlete stats, and memorable moments, with an optional entry into the existing advanced team tracker. For practices, offer practice notes or moments instead of score prompts.
- **Share:** preview what supporters will see, choose visible details, publish the card, copy/share one persistent link, and later unpublish if necessary.

Keep navigation among these areas simple on a phone. The workspace is the place where the owner manages this event; the published card is the supporter-facing view. Edits to a published card should update its existing link. Draft-only and private content must stay hidden.

## Athlete information

When creating a new Game On card, selecting an athlete should prefill appropriate athlete information from their profile (such as display name, sport, team, and Hype Page link). The card should retain a stable reference to the athlete, so a change to the profile can appear on future and existing cards where appropriate. Event-specific details—opponent, date, location, prep, results, moments, visibility—belong to that card. Do not copy one game's stats or prep into the next game.

Support multiple athletes if the existing account model already allows it. Do not require a roster. Preserve existing athlete and event data.

## Shared card

The supporter-facing Game On link should answer, at a glance: **Who's playing? When and where? How can I follow?** Present matchup and event details first, then only the available actions: map, live stats/follow link, selected shared prep/help request, and latest athlete Hype Page. If an action has no content, hide it rather than showing an empty panel. For a completed game, show the result prominently and retain the useful event information.

If PIXL is tracking live stats, link to that view. Allow an external follow link when the game is being tracked elsewhere, if this fits the current model. Label each clearly. Make sure the shared view works without asking the recipient to create an account, subject to the current access/privacy design.

**Hype Cards remain independent.** Users can create and send them any time, without a Game On card. Optionally let them associate a Hype Card with an event or athlete. The athlete Hype Page remains its own shareable destination and is linked from relevant Game On cards.

## Scope and migration

Remove the full calendar builder from the primary user flow. Replace it with Create Game On, the carousel, and View all. Do not delete underlying event records just because the calendar UI changes. Offer new **Game** and **Practice** cards only; remove Meeting from new event creation. Inspect any existing meeting data and preserve a safe way to access or export it before hiding old views.

Reuse the existing prep, stat tracker, Hype Page, and Hype Card functionality instead of rewriting it. Keep full team stats accessible as an advanced option while making individual athlete capture the easy default. Preserve existing URLs or redirect them appropriately. If a schema migration is needed, show the proposed change and data handling before applying it.

## Implement in phases

1. Build the dashboard card carousel, View all, and Create Game On flow using existing event data where possible.
2. Build the owner's card workspace by connecting existing details, prep, and tracker functions.
3. Build the published card preview and stable share link with clear privacy controls.
4. Connect athlete profile and Hype Page data; make Hype Cards independently accessible.
5. Polish mobile behavior, empty states, event status, and migration of existing users.

At the end of each phase, tell me what changed and let me inspect it before expanding the scope.

## Acceptance checks

- A first-time parent can create and share a game card without setting up a calendar, coach account, or roster.
- The owner can return to a card and quickly open Prep or Track.
- The supporter link stays the same when game details or live stats update.
- Private prep and draft content never appear in the shared view.
- A practice does not ask for an opponent, final score, or game stats unless an existing relevant flow explicitly requires one.
- Existing stats, events, and Hype content remain available.
- A Hype Card can be created and sent with no Game On card.
- The carousel is usable on mobile, and View all makes older cards easy to find.
