# Native Season Stats checks

The feature card belongs immediately beneath Game Record on the dashboard.
It opens the private native Season Stats page, not a public HYPE Card.

## Available automated checks

- Backend history policy: `pnpm --filter @workspace/league-matrix-studio exec tsx --test ../api-server/src/lib/nativeSeasonStats.test.ts`
- Native integration source checks: `node --test ios/Tests/NativeSeasonStatsSourceChecks.mjs`
- On a Mac: compile `ios/PIXL Sports/NativeSeasonStats.swift` and
  `ios/Tests/NativeSeasonStatsChecks.swift` together with `swiftc`, then run the
  resulting executable.
- In Xcode run the dashboard UI cases
  `testSeasonStatsFeatureOpensChartsComparisonsAndGameDetails` and
  `testSeasonStatsEmptyStateDoesNotInventAChart`.

## Apple runtime / real-account checks

1. Open Season Stats with a hidden or paused HYPE Card. Private history still
   loads; no public card is published or required.
2. Check an athlete-tagged game and a team-only game. Athlete averages exclude
   games without athlete data; team scores never become athlete statistics.
3. Confirm unentered scoreboards are not charted as zero. Verify same-day
   games retain separate history rows and all graph points.
4. Load the page online, terminate, then reopen without a connection. The
   saved history remains visible under the same verified account.
5. With a freshly prepared workspace, finish a game offline. Open Season Stats:
   the local final appears once with a waiting-to-sync label. Reconnect and
   confirm the label clears after acknowledgement, without a duplicate game.
6. Correct a finalized game online, then refresh on the phone. An older,
   queue-free workspace must not override the correction.
7. Switch accounts, sign out, unlink, and revoke access. Neither cached season
   history nor an in-flight response may appear for the new/signed-out account.
8. Check small iPhones, landscape, accessibility text, Reduce Motion, and
   VoiceOver. Read chart points and open each game detail.
9. Remove an Event Card without deleting its recorded game. The retained game
   stays in season history after refresh.

The first private history download requires connectivity. Cached history and
matching prepared local finals then remain available offline. Workspaces
cached before project-identity metadata was introduced need a connected refresh
before they can be merged safely. No source check substitutes for an Apple
compiler or rendered SwiftUI run.
