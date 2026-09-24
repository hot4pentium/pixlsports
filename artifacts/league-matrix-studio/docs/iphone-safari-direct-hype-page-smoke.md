# iPhone Safari: direct Hype Page video posting smoke test

This is a **manual physical-device release check**, not a Chromium emulation test. Run it on an actual iPhone in Safari against the **published Pixl Sports app**, not the Replit preview, localhost, an installed Home Screen app, or a mocked API. The workspace has no connected iPhone; a run is **not passed** until a tester completes the record below on a real device. Do not mark an unrun check as passing.

## Setup and run record

Before each run, get the current published URL from the project's Publishing page (or deployment metadata). At the time this checklist was written, the published origin was `https://league-matrix-creative-studio.replit.app`; do **not** assume it is still current for a later run. Confirm the current URL loads in iPhone Safari and that the owner management screen has **Add a video here**. If that control is missing, the deployed build is not ready for this test: publish the intended build first, then start a new run. The media request must also use this **same published origin** (the production `/api/hype-card-shares/.../media/video` proxy), not a development or storage URL. Do not substitute a browser simulator for any step.

Use a disposable, live, unpaused Athlete Hype Page owned by the signed-in test account, with **Video highlights** enabled and fewer than 10 active videos. Do not use a real family's page. Take a baseline of **Manage posted videos** and the public page's video carousel (names and count); use a unique moment name for each attempt. Have a short iPhone Photos clip **with audible sound**, under 120 MB and long enough to select a 5–10 second segment. Use an iPhone with enough free storage, network access, and battery. The test creates a public video; remove the successful test post using **Delete** on the management page when the evidence is recorded, and confirm it disappears after refresh.

Copy this record per device/build. Keep invite and share tokens, account details, and original video private; redact URLs in screenshots/logs.

| Field | Observation |
| --- | --- |
| Date/time and tester | |
| Published origin and build/release identifier | |
| iPhone model / iOS version / Safari version | |
| Network (Wi-Fi or cellular) and clip format, size, length, audio present | |
| Baseline public video count and owner posted-video count | |
| Cancel during preparation: stage and highest observed %; result after refresh | |
| Cancel during upload: stage and highest observed %; result after refresh | |
| Forced failure: stage/error and result after refresh | |
| Successful post: preparation % above 1, upload stage/highest %, success message | |
| Public page after refresh: named video present, picture/audio play and seek | |
| Production media proxy: range response status, content type, content range | |
| Cleanup: deleted test post absent after public and owner refresh | |
| Overall PASS/FAIL/NOT RUN, issue link or notes | |

## 1. Cancel before a share is created

1. In iPhone Safari sign in as the owner. Open the disposable public Hype Page and tap **Manage** (or open its saved `/player/<invite-token>/manage` URL). Under **Manage posted videos**, record the baseline.
2. Tap **Add video**, choose the clip from Photos, wait for its duration and preview, choose a 5–10 second segment, and enter a unique **Moment name** such as `safari-cancel-prep-...`. Tap **Post video**.
3. While the page says **Preparing a web-friendly video…**, note the highest displayed percentage and tap **Cancel**. Wait for **Video upload cancelled. The original video remains on this device.** If preparation fails before there is time to cancel, record the failure; do not report the cancellation path as passed.
4. Refresh the management page, then open and refresh the public Hype Page. The cancelled name must be absent from **Manage posted videos** and the public video carousel; previous baseline items remain unchanged.
5. Repeat with a new name, but wait until **Uploading the prepared video and poster…** appears (55% or higher) before tapping **Cancel**. Verify the same absence after both refreshes. A slow connection or a 12–15 second segment can make this stage easier to catch. If the stage is too fast to cancel, record **NOT RUN** for upload cancellation, not PASS. Do not treat a tap after **Adding the video to the Athlete Hype Page…** as proof of safe cancellation: the final save may already be in flight. If a late tap results in a post, mark FAIL and remove it via **Delete**.

## 2. Failed upload does not leave a partial share

1. Restore connectivity, select the same clip again with another unique name, and wait for metadata. Turn on Airplane Mode **before** tapping **Post video** (disable Wi-Fi as well). If the video cannot be prepared offline, this still tests a failed posting path; record the actual stage and error. Do not leave Safari or reload while preparation is in progress.
2. Wait for an error and for the button to return to **Post video**. Do not retry the same attempt. If it hangs instead, record FAIL and the elapsed time.
3. Restore connectivity. Refresh management and public pages and check that neither contains that name or a new blank/partial video. Compare both counts with the baseline. A leftover share is FAIL even if its video does not play. Never expose an incomplete post to real supporters.

## 3. Complete post and playback through the production proxy

1. With connectivity restored, select the audible clip again and give it a new unique name. Tap **Post video**. Keep Safari foregrounded and the display awake until it finishes. Record a percentage **above the initial 1%** while **Preparing a web-friendly video…** is shown; a fixed 1% alone is not preparation progress. Record **Uploading the prepared video and poster…** and its highest percentage; **Adding the video to the Athlete Hype Page…** (around 90%) means the video and poster uploads have finished. Finally require **Video added to the Athlete Hype Page.** Do not infer upload success from the percentage alone.
2. Confirm exactly one new matching title in **Manage posted videos**. Tap **Back to Hype Page**, refresh Safari, locate the new title in **Video highlights**, and play it. Confirm moving picture, **audible sound** (volume on/unmuted), and seeking near the end of the selected segment. A visible poster, a playing timer, or an audio track indicator without actual sound is not enough. Reload once more and replay, including on the same published URL when signed out/private browsing if access permits. A missing video, silent clip, or failed playback is FAIL.
3. Verify that the player fetched media from the **current production proxy**. On a paired Mac, Safari's Develop → iPhone → page Web Inspector Network tab can show the video request. Alternatively, using the public page URL's token on a trusted workstation, inspect its public API response to find the matching `videos[].videoUrl` and issue a bounded range GET (do not save/share the video bytes):

   ```sh
   # Set these locally; do not paste the tokens into a shared run record.
   ORIGIN='https://<current-published-origin>'
   INVITE_TOKEN='<token-from-the-disposable-page-url>'
   # Inspect the response locally and copy the videoUrl for the unique test title:
   curl -fsS "$ORIGIN/api/athlete-invites/$INVITE_TOKEN"
   VIDEO_PATH='/api/hype-card-shares/<share-token>/media/video'
   curl -sS -o /dev/null -D - -H 'Range: bytes=0-1023' "$ORIGIN$VIDEO_PATH"
   ```

   Require HTTP **206**, `Accept-Ranges: bytes`, `Content-Range: bytes 0-1023/<size>` (or `0-<last>` if shorter), nonzero `Content-Length`, and `Content-Type: video/mp4` or `video/webm`. The request must be to the same published origin, never a direct object-storage upload URL. Record only redacted headers/status; the Safari playback after refresh is still mandatory. A 200, 404, 416, 5xx, or cross-origin storage URL is FAIL.
4. Remove only the newly created test video using **Delete** on the owner management page, confirm the dialog, and refresh both views. Verify the count/title returns to baseline. If a failure left an unintended post, delete that item too and record the failure; cleanup does not turn FAIL into PASS.

## Result rule

PASS requires all cancel and failure cases absent after refresh, preparation moving beyond 1%, a completed upload and final success, one newly posted video playing with picture **and audible sound** after refresh, and a 206 ranged response from the current production proxy. Record each observed value above. Any missing observation is **NOT RUN** for that case; any mismatch is **FAIL** with the device/iOS version, stage, percentage, redacted response details, and reproduction notes. Do not claim a physical-device pass based on local unit tests, Chromium, or this document alone.