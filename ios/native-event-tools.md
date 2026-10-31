# Native Event Card tools

The iPhone dashboard shows event details on the Message Board and a three-column,
square Event Card grid. Opening a card leads to SwiftUI Prep, game stats, and
native sharing—not embedded web tools.

## Data and saving

- Every private request verifies the native Clerk identity and resolves its
  explicit PIXL account link. Matching email addresses are never authority.
- Prep reads and updates the existing account/event checklist record, including
  an already shared checklist. Save Prep is explicit; unsaved edits have a back
  confirmation.
- Tracking reads the existing Stat Tracker cloud project and updates only the
  selected game's session. Other games and unrelated payload fields are retained.
- Both tools check revisions. A conflicting save requires discarding the pending
  command and reloading; it never silently overwrites another device's work.
- A failed request keeps its exact command and mutation ID on this iPhone, scoped
  to the native account and event. Retrying does not duplicate a saved tap.
  A command also contains the account-link ID, preventing replay after relinking.
- Writes require a connection and server acknowledgment. This is not an offline
  tracker; don't describe an unacknowledged tap as saved.

## Current native tracker

Supports sport-specific stat buttons, athlete/team attribution, separate team and
opponent scores, period advancement, undo, pause/resume, and explicit finishing.
Football includes opponent possession and per-play yards; new soccer sessions
choose halves or quarters. Existing games retain their saved sport.

Athlete-only taps do not adjust the team scoreboard. Finishing without a recorded
score does not fabricate a 0–0 tie. Final games are read-only in this first native
tracker. Advanced web features such as final corrections and specialized compound
hit/pitch/pass workflows are not all ported yet.

Finishing saves the game and completes its Event Card. Existing spectator shares
receive updates, but native tracking never creates or extends public access.

## Sharing

Upcoming cards use the iOS share sheet for event details, including the event time
zone. Completed cards lead to the athlete's existing public HYPE Card, where the
iOS share sheet shares its `/fan/` link. A hidden/private HYPE Card is not
automatically published. Public links use the app's configured server environment;
development links therefore require the development preview to be accessible.

## API

Both endpoints use the existing native bearer-token middleware:

- `POST /api/native/supporter/event-workspace` with `{ shareToken }`
- `POST /api/native/supporter/event-workspace-save` with the selected command,
  revision, mutation ID, and current link ID

No database migration is required.

## Verification

Backend regression tests:

```sh
pnpm --filter @workspace/league-matrix-studio exec tsx --test ../api-server/src/lib/nativeEventWorkspace.test.ts
pnpm --filter @workspace/api-server typecheck
```

Dashboard XCTest coverage checks square grid geometry, three cards per row,
Message Board event details, and native event navigation. Run these tests and
build the iPhone target in Xcode on macOS; the Replit Linux environment cannot
compile or render this SwiftUI app.

## Opened Event Card steps

Event details use a two-column grid at standard text sizes and a single column
at accessibility sizes. A safe-area bottom bar keeps Prep, Track Stats, and
Share visible while scrolling. Each opens its native screen. Share offers
event text and the existing HYPE Card viewer, without publishing private cards.

For games, Prep is recommended until one hour before the event's resolved
kickoff instant; Track Stats from -1 hour through just before +1 hour; Share
from +1 hour onward. The bar refreshes its recommendation while open. This
does not start, finish, or save a game. Historical detail screens remain on
their selected event; dashboard selection still advances independently.
Practices keep Prep until +2 hours, then Share, with game tracking disabled.
Missing kickoff times stay on Prep rather than inventing a time.

The standalone timing checks can run on a Mac with the Swift toolchain:

```sh
swiftc "ios/PIXL Sports/NativeEventDetailStep.swift" ios/Tests/NativeEventDetailStepChecks.swift -o /tmp/pixl-event-step-checks
/tmp/pixl-event-step-checks
```
