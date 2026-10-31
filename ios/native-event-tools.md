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
- Stat taps are added immediately to an account- and event-scoped iPhone outbox,
  shown optimistically, and sent one at a time. The outbox survives app suspension.
  Each tap keeps its mutation ID and sent revision until acknowledged, so a retry
  after a lost response cannot duplicate a saved play. Later queued taps use the
  revision returned by the previous acknowledgment.
- A failed request keeps its exact command on this iPhone. Revision conflicts
  remain visible and require an explicit retry or discard-and-reload choice.
  Commands include the account-link ID, preventing replay after relinking.
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

The durable iPhone outbox interruption check can run anywhere with Swift:

```sh
swiftc "ios/PIXL Sports/NativeEventDurableQueue.swift" ios/Tests/NativeEventDurableQueueChecks.swift -o /tmp/pixl-event-queue-checks
/tmp/pixl-event-queue-checks
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

The Message Board always opens Event Details for its chosen Event Card. The
initial Content panel and highlighted step use the same time recommendation,
so Get Ready opens with Prep selected while live and postgame actions select
Track Stats and Share.

The Prep Content panel starts with four interactive checklist items and a
progress count. “Manage full Prep” opens the existing editor in place for the
complete list, notes, adding, removing, and saving without losing quick edits.

Track Stats opens directly to scorekeeping in Content: team and opponent scores,
Start game, and End game with explicit final-score confirmation. This compact
panel has no player-stat buttons. Access Live Taps opens the existing fan-access
panel; Back to scorekeeping returns without discarding its QR. Open full tracker
uses the same workspace model and saved game for individual stats and advanced
controls. A game paused in the full tracker can be resumed in the score panel.

The standalone timing checks can run on a Mac with the Swift toolchain:

```sh
swiftc "ios/PIXL Sports/NativeEventDetailStep.swift" "ios/PIXL Sports/NativeEventGuideTiming.swift" ios/Tests/NativeEventDetailStepChecks.swift -o /tmp/pixl-event-step-checks
/tmp/pixl-event-step-checks
```
