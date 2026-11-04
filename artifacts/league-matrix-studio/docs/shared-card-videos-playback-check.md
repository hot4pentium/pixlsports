# Shared HYPE Card Videos playback check

## Automated check

Run from the workspace root:

```sh
pnpm --filter @workspace/league-matrix-studio test:shared-card-videos-browser
pnpm --filter @workspace/league-matrix-studio exec tsx --test \
  ../api-server/src/hypeCardVideoPlayback.test.ts \
  ../api-server/src/lib/httpByteRange.test.ts
```

The first command drives actual browsers against the production
`LivingAthleteCardPage`, with a signed-out public fan-card manifest fixture. It
generates a 12-second H.264/AAC MP4, delivered from the existing hosted-media URL
shape using the production byte-range parser. Media events are not mocked.
The fixture performs only public reads; it does not upload, change visibility,
follow a card, or request alert permission.

Covered in Chromium mobile touch and WebKitGTK at a measured 390px CSS width:

- Empty Videos face, without a player or a broken-media state.
- Selecting a hosted clip; real playback time advances without stalling.
- Inline player, controls, unmuted audio, and no forced fullscreen.
- Front and Events selected during playback; retained outgoing players pause.
- A paused outgoing player's clock stops advancing, preventing hidden audio.
- Returning to Videos requires another deliberate selection, not autoplay.
- Switching from the playing clip to a failed clip stops the old player.
- A 404 produces a readable error and retry control; retry fails visibly;
  selecting the valid clip recovers.
- Reopening the same link returns to Front without resuming audio; the valid
  clip still plays after selecting Videos again.
- Real Chromium media requests use partial content. Small range probes,
  bounded open-ended ranges, and unsatisfiable responses are checked.

The separate API test exercises the **actual hosted-media Express route**, with
a temporary database share and mocked storage bytes representing a 35MB video.
It verifies `206`, `Accept-Ranges`, `Content-Range`, `Content-Length`,
`Content-Disposition: inline`, 4MB response bounds, subsequent chunks,
suffix ranges, `416`, and revoked-link denial. It removes its temporary rows.
The browser fixture alone is not evidence that production storage/proxy delivery
works; it uses a local encoded test clip, not an existing customer's share.

Generated clips, screenshots, and range traces live under
`generated-artifacts/shared-card-videos/`, excluded from Git and deployment.
Temporary fixture source files and browser profiles are removed on completion.

For a targeted engine investigation, prefix the first command with
`VIDEO_TEST_ENGINE=chromium` or `VIDEO_TEST_ENGINE=webkit`. The default runs both
and fails rather than silently skipping an unavailable engine.

## WebKit environment

Linux WebKitGTK is **not iOS Safari or a physical phone test**. Its desktop window
has a minimum width, so the check uses a same-origin 390px iframe and native
keyboard activation. Chromium uses actual emulated mobile touch input.

WebKitGTK requires the configured GStreamer base/good/bad/libav packages for
H.264/AAC decoding. The runner discovers their installed plugin paths and matches
the installed Mesa provider. GTK 2.48 hardcodes `/var/tmp` for media buffering;
this workspace mounts it read-only. A test-only PRoot bind maps `/tmp` onto that
location for the WebKit process tree. It does not change the app, media URLs,
encoding, or host filesystem, and it does not disable the browser sandbox.
The runner terminates the entire test-owned process group so descendants cannot
keep the test process alive.

## Physical iPhone Safari release check

Not executed in the Linux workspace. Use a test owner's **already-public** HYPE
Card and already-hosted H.264/AAC clip; do not publish private cards or upload
customer media to run this check. Record iPhone model, iOS version, connection,
link, and outcome in release evidence without committing private link tokens.

1. Open an empty shared card in Safari, select Videos, and confirm the empty
   message, no blank player, and no unexpected sound.
2. Open the populated test card. Select Videos, then the hosted clip. Confirm
   visible motion, audible sound, functioning controls, and inline playback
   without automatic fullscreen. Play for several seconds and seek forward.
3. While it plays, select Front. Sound must stop as the face changes. Wait
   several seconds; there must be no background sound.
4. Return to Videos. Playback must not restart by itself. Select the clip again,
   then select Events during playback. Repeat the no-hidden-audio check.
5. With Safari Web Inspector request blocking (or a controlled unavailable test
   clip), fail only the media request. Confirm a visible failure, reachable
   retry, and successful playback after restoring access and retrying/selecting
   the valid clip. Do not revoke a real user's clip to manufacture a failure.
6. Close/reopen the public link. It must start on Front with no audio; Videos
   must remain usable. Confirm the same after Safari background/foreground.
7. Inspect the hosted media network responses for `206`/`Content-Range` on
   browser range requests. For a realistically sized test clip, separately
   inspect `bytes=0-1`, `bytes=0-`, seeking, and an unsatisfiable range. A thumbnail
   or an initial `206` alone does not prove complete playback through the proxy.

Do not report Safari/device sign-off until these steps have been run on Apple
hardware. Linux WebKit results cannot establish iOS audio routing, Safari
toolbar behavior, low-power restrictions, or physical-device smoothness.
